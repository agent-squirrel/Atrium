"""
Guest-facing captive portal routes.

Unifi redirects guests to: /p/<slug>?id=<mac>&ap=<ap_mac>&ssid=<ssid>&t=<ts>&url=<redirect_url>
"""

from datetime import datetime, timezone, timedelta
from flask import render_template, render_template_string, request, redirect, url_for, current_app, jsonify
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from app.extensions import db
from app.models import Portal, PortalField, GuestSession, Voucher, AuthType, PlatformSetting
from app.services.unifi import UnifiClient, UnifiError
from . import portal_bp
import logging

logger = logging.getLogger(__name__)

# How long a signed connect token stays valid between the initial form submit
# and the deferred finalize() call - generous enough to tolerate a slow device
# or page load, tight enough that a leaked/replayed token can't be reused later.
_CONNECT_TOKEN_SALT = "guest-connect"
_CONNECT_TOKEN_MAX_AGE = 600

_MAINTENANCE_PAGE = """
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Back Soon</title>
<style>
  body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;
       min-height:100vh;margin:0;background:#f3f4f6}
  .box{background:#fff;border-radius:12px;padding:2.5rem;max-width:420px;
       text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  h1{font-size:1.25rem;color:#111827;margin-bottom:.5rem}
  p{color:#6b7280;font-size:.95rem;line-height:1.6}
</style>
</head>
<body><div class="box">
  <h1>{{ portal.name if portal else "Wi-Fi Portal" }}</h1>
  <p>This portal is temporarily undergoing maintenance.<br>Please try again in a few minutes.</p>
</div></body>
</html>
"""


def _get_setting(key: str, default: str = "") -> str:
    s = db.session.get(PlatformSetting, key)
    return s.value if s and s.value is not None else default


def _is_maintenance(portal=None) -> bool:
    """True if global, controller-level, or portal-level maintenance is on."""
    if _get_setting("maintenance_mode", "false") == "true":
        return True
    if portal and portal.site and portal.site.controller and portal.site.controller.maintenance_mode:
        return True
    if portal and portal.maintenance_mode:
        return True
    return False


def _connect_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=_CONNECT_TOKEN_SALT)


@portal_bp.route("/<slug>")
def show_portal(slug):
    portal = Portal.query.filter_by(slug=slug, is_active=True).first_or_404()
    if _is_maintenance(portal):
        return render_template_string(_MAINTENANCE_PAGE, portal=portal), 503

    # Params supplied by Unifi
    mac = request.args.get("id", "")
    ap_mac = request.args.get("ap", "")
    ssid = request.args.get("ssid", "")
    redirect_url = portal.redirect_url or request.args.get("url", "")
    t = request.args.get("t", "")

    fields = portal.fields.order_by(PortalField.order).all()

    return render_template(
        "portal/index.html",
        portal=portal,
        fields=fields,
        mac=mac,
        ap_mac=ap_mac,
        ssid=ssid,
        redirect_url=redirect_url,
        t=t,
        error=None,
    )


@portal_bp.route("/<slug>/connect", methods=["POST"])
def connect(slug):
    portal = Portal.query.filter_by(slug=slug, is_active=True).first_or_404()
    if _is_maintenance(portal):
        return render_template_string(_MAINTENANCE_PAGE, portal=portal), 503

    mac = request.form.get("mac", "").strip()
    ap_mac = request.form.get("ap_mac", "").strip()
    ssid = request.form.get("ssid", "").strip()
    redirect_url = request.form.get("redirect_url", portal.redirect_url or "").strip()
    t = request.form.get("t", "")

    fields = portal.fields.order_by(PortalField.order).all()

    # ── Validate required fields ─────────────────────────────────────────────
    form_data = {}
    errors = []

    for field in fields:
        value = request.form.get(field.field_key, "").strip()
        if field.is_required and not value:
            errors.append(f"{field.label} is required.")
        form_data[field.field_key] = value

    # ── Terms & Conditions acceptance (if required) ──────────────────────────
    if portal.require_terms_acceptance and request.form.get("terms_accepted") != "true":
        errors.append("You must accept the Terms & Conditions to continue.")

    # ── Voucher check (if applicable) ────────────────────────────────────────
    voucher = None
    if portal.auth_type in (AuthType.VOUCHER, AuthType.BOTH):
        code = request.form.get("voucher_code", "").strip().upper()
        if not code:
            if portal.auth_type == AuthType.VOUCHER:
                errors.append("A voucher code is required.")
        else:
            voucher = Voucher.query.filter_by(portal_id=portal.id, code=code).first()
            if not voucher or not voucher.is_valid:
                errors.append("Invalid or expired voucher code.")

    if errors:
        return render_template(
            "portal/index.html",
            portal=portal,
            fields=fields,
            mac=mac,
            ap_mac=ap_mac,
            ssid=ssid,
            redirect_url=redirect_url,
            t=t,
            error=" ".join(errors),
        ), 422

    # ── Determine session duration and bandwidth limits ───────────────────────
    default_duration = int(_get_setting("default_session_duration", "60"))
    duration = portal.session_duration or default_duration

    def _kbps(portal_val, setting_key):
        if portal_val and portal_val > 0:
            return portal_val
        v = _get_setting(setting_key, "")
        try:
            n = int(v)
            return n if n > 0 else None
        except (ValueError, TypeError):
            return None

    rate_down = _kbps(portal.rate_limit_down, "default_rate_limit_down")
    rate_up = _kbps(portal.rate_limit_up, "default_rate_limit_up")

    if voucher:
        duration = voucher.duration_minutes
        rate_down = voucher.rate_limit_down or rate_down
        rate_up = voucher.rate_limit_up or rate_up

    # ── Defer actual authorization ───────────────────────────────────────────
    # The device is NOT authorized yet - that happens in finalize(), called by
    # JS on the success page after portal.connect_delay_seconds. This
    # guarantees the post-connect page is visible for at least that long:
    # some devices (iOS/macOS Captive Network Assistant, Android's connectivity
    # check) auto-close the captive-portal browser the instant they detect
    # real internet access, which could otherwise happen before this page
    # even paints.
    token = _connect_serializer().dumps({
        "portal_id": portal.id,
        "mac": mac,
        "ap_mac": ap_mac,
        "ssid": ssid,
        "client_ip": request.headers.get("X-Real-IP") or request.remote_addr,
        "redirect_url": redirect_url,
        "duration": duration,
        "rate_down": rate_down,
        "rate_up": rate_up,
        "voucher_id": voucher.id if voucher else None,
        "form_data": form_data,
    })

    return redirect(url_for("portal.success", slug=slug, token=token))


@portal_bp.route("/<slug>/success")
def success(slug):
    portal = Portal.query.filter_by(slug=slug).first_or_404()
    token = request.args.get("token", "")
    if not token:
        # Nothing to finalize (e.g. a bookmarked/direct hit) - send them
        # through the form instead of showing a dead-end success page.
        return redirect(url_for("portal.show_portal", slug=slug))
    redirect_url = portal.redirect_url or request.args.get("url", "")
    return render_template(
        "portal/success.html",
        portal=portal,
        redirect_url=redirect_url,
        token=token,
    )


@portal_bp.route("/<slug>/finalize", methods=["POST"])
def finalize(slug):
    """Called by JS on the success page once connect_delay_seconds has
    elapsed. This is where the guest is actually authorized with UniFi -
    see the comment in connect() for why this is deferred."""
    portal = Portal.query.filter_by(slug=slug, is_active=True).first_or_404()

    token = request.form.get("token", "")
    try:
        payload = _connect_serializer().loads(token, max_age=_CONNECT_TOKEN_MAX_AGE)
    except SignatureExpired:
        return jsonify({"ok": False, "error": "This connection link has expired. Please reconnect."}), 410
    except BadSignature:
        return jsonify({"ok": False, "error": "Invalid connection request."}), 400

    if payload.get("portal_id") != portal.id:
        return jsonify({"ok": False, "error": "Invalid connection request."}), 400

    mac = payload.get("mac", "")

    # Idempotency guard - a retried/duplicate finalize call for the same
    # already-processed connect attempt should report success without
    # re-authorizing or double-counting voucher usage.
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=_CONNECT_TOKEN_MAX_AGE)
    existing = GuestSession.query.filter(
        GuestSession.portal_id == portal.id,
        GuestSession.mac_address == mac,
        GuestSession.authorized_at >= cutoff,
    ).order_by(GuestSession.authorized_at.desc()).first()
    if existing:
        if existing.auth_success:
            return jsonify({"ok": True})
        return jsonify({"ok": False, "error": "Could not connect you at this time. Please try again or contact support."}), 503

    voucher = db.session.get(Voucher, payload["voucher_id"]) if payload.get("voucher_id") else None

    site = portal.site
    controller = site.controller

    auth_success = False
    auth_error = None
    try:
        client = UnifiClient(controller)
        client.authorize_guest(
            site_id=site.unifi_site_id,
            mac=mac,
            minutes=payload.get("duration"),
            down_kbps=payload.get("rate_down"),
            up_kbps=payload.get("rate_up"),
        )
        auth_success = True
        if voucher:
            voucher.usage_count += 1
    except UnifiError as e:
        auth_error = str(e)
        logger.error("Unifi auth failed for MAC %s on portal %s: %s", mac, slug, e)

    session = GuestSession(
        portal_id=portal.id,
        mac_address=mac,
        ip_address=payload.get("client_ip"),
        ap_mac=payload.get("ap_mac"),
        ssid=payload.get("ssid"),
        voucher_id=voucher.id if voucher else None,
        form_data=payload.get("form_data") or {},
        auth_success=auth_success,
        auth_error=auth_error,
    )
    db.session.add(session)
    db.session.commit()

    if not auth_success:
        return jsonify({"ok": False, "error": "Could not connect you at this time. Please try again or contact support."}), 503

    return jsonify({"ok": True})
