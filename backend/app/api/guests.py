import csv
import io
import math
from collections import defaultdict, Counter
from datetime import datetime, timezone, timedelta
from flask import request, jsonify, Response
from app.extensions import db
from app.models import GuestSession, Portal, AccessPoint, PlatformSetting
from app.models import PortalField
from app.services.unifi import UnifiClient, UnifiError
from . import api_bp
from .decorators import require_auth, get_current_user


# ── Active devices (live from UniFi) ─────────────────────────────────────────

@api_bp.route("/portals/<int:portal_id>/active_devices", methods=["GET"])
@require_auth
def get_active_devices(portal_id):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal)
    try:
        client = UnifiClient(portal.site.controller)
        clients = client.get_active_clients(site_id=portal.site.unifi_site_id)
        if portal.ssids:
            clients = [c for c in clients if c.get("essid") in portal.ssids]
        else:
            # "All SSIDs" should still mean "every wireless guest client on
            # this site", not literally every device on it. Wired clients
            # (no essid) are never relevant here. When UniFi tells us which
            # SSIDs have its own "Guest Policy" flag on (local controllers
            # only - the cloud API doesn't expose WLAN config, so this is
            # empty there), narrow to those too; an empty result means
            # "unknown", not "no guest SSIDs", so don't filter on it.
            guest_ssids = set(client.get_guest_ssid_names(site_id=portal.site.unifi_site_id))
            clients = [
                c for c in clients
                if c.get("essid") and (not guest_ssids or c["essid"] in guest_ssids)
            ]
        devices = [_unifi_device_dict(c) for c in clients]
        return jsonify({"devices": devices})
    except UnifiError as e:
        return jsonify({"devices": [], "error": str(e)}), 502


# ── Historical sessions (from DB) ────────────────────────────────────────────

@api_bp.route("/portals/<int:portal_id>/guests", methods=["GET"])
@require_auth
def list_guests(portal_id):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal)

    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 50, type=int), 200)
    search = request.args.get("search", "").strip()
    mac = request.args.get("mac", "").strip()
    ssid = request.args.get("ssid", "").strip()
    date_from = request.args.get("date_from", "").strip()
    date_to = request.args.get("date_to", "").strip()

    q = GuestSession.query.filter_by(portal_id=portal_id)

    if search:
        q = q.filter(
            GuestSession.mac_address.ilike(f"%{search}%") |
            GuestSession.ip_address.ilike(f"%{search}%")
        )
    if mac:
        q = q.filter(GuestSession.mac_address.ilike(f"%{mac}%"))
    if ssid:
        q = q.filter(GuestSession.ssid == ssid)
    if date_from:
        try:
            q = q.filter(GuestSession.authorized_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            q = q.filter(GuestSession.authorized_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass

    q = q.order_by(GuestSession.authorized_at.desc())
    total = q.count()
    sessions = q.offset((page - 1) * per_page).limit(per_page).all()
    pages = math.ceil(total / per_page) if total else 1

    return jsonify({
        "items": [_session_dict(s) for s in sessions],
        "total": total,
        "page": page,
        "pages": pages,
        "per_page": per_page,
    })


@api_bp.route("/portals/<int:portal_id>/guests/summary", methods=["GET"])
@require_auth
def guests_summary(portal_id):
    """Aggregated analytics: field value counts + sessions by day."""
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal)

    q = GuestSession.query.filter_by(portal_id=portal_id)

    mac = request.args.get("mac", "").strip()
    ssid = request.args.get("ssid", "").strip()
    date_from = request.args.get("date_from", "").strip()
    date_to = request.args.get("date_to", "").strip()

    if mac:
        q = q.filter(GuestSession.mac_address.ilike(f"%{mac}%"))
    if ssid:
        q = q.filter(GuestSession.ssid == ssid)
    if date_from:
        try:
            q = q.filter(GuestSession.authorized_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            q = q.filter(GuestSession.authorized_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass

    sessions = q.all()
    fields = portal.fields.order_by(PortalField.order).all()

    field_counts: dict = {}
    for field in fields:
        counts: dict = {}
        for s in sessions:
            val = (s.form_data or {}).get(field.field_key, "")
            if val:
                counts[val] = counts.get(val, 0) + 1
        field_counts[field.field_key] = {
            "label": field.label,
            "field_type": field.field_type,
            "values": [
                {"value": v, "count": c}
                for v, c in sorted(counts.items(), key=lambda x: -x[1])
            ],
        }

    # Sessions by calendar day
    by_day: dict = defaultdict(int)
    for s in sessions:
        by_day[s.authorized_at.date().isoformat()] += 1

    # Peak hours (0–23)
    by_hour: dict = defaultdict(int)
    for s in sessions:
        by_hour[s.authorized_at.hour] += 1
    sessions_by_hour = [{"hour": h, "count": by_hour.get(h, 0)} for h in range(24)]

    # Day-of-week pattern (0=Mon … 6=Sun)
    _DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    by_dow: dict = defaultdict(int)
    for s in sessions:
        by_dow[s.authorized_at.weekday()] += 1
    sessions_by_dow = [{"day": _DOW[d], "count": by_dow.get(d, 0)} for d in range(7)]

    # Return visitor rate
    mac_counts = Counter(s.mac_address for s in sessions)
    total_unique = len(mac_counts)
    returning = sum(1 for c in mac_counts.values() if c > 1)
    return_visitor_rate = round(returning / total_unique * 100, 1) if total_unique else 0.0

    # Auth failure stats
    failed = [s for s in sessions if not s.auth_success]
    error_counts = Counter(s.auth_error or "Unknown error" for s in failed)
    auth_failures = {
        "count": len(failed),
        "rate": round(len(failed) / len(sessions) * 100, 1) if sessions else 0.0,
        "top_errors": [{"error": e, "count": c} for e, c in error_counts.most_common(5)],
    }

    # Top access points by session count
    ap_counts = Counter(s.ap_mac for s in sessions if s.ap_mac)
    top_mac_list = [mac for mac, _ in ap_counts.most_common(10)]
    ap_names = {
        ap.mac_address: ap.name
        for ap in AccessPoint.query.filter(AccessPoint.mac_address.in_(top_mac_list)).all()
    }
    top_aps = [
        {"ap_mac": mac, "name": ap_names.get(mac) or mac, "count": cnt}
        for mac, cnt in ap_counts.most_common(10)
    ]

    return jsonify({
        "total_sessions": len(sessions),
        "unique_devices": total_unique,
        "return_visitor_rate": return_visitor_rate,
        "sessions_by_day": [{"date": k, "count": v} for k, v in sorted(by_day.items())],
        "sessions_by_hour": sessions_by_hour,
        "sessions_by_dow": sessions_by_dow,
        "auth_failures": auth_failures,
        "top_aps": top_aps,
        "field_counts": field_counts,
    })


# ── Per-session routes ────────────────────────────────────────────────────────

@api_bp.route("/guests/<int:session_id>", methods=["GET"])
@require_auth
def get_guest(session_id):
    session = GuestSession.query.get_or_404(session_id)
    _assert_portal_access(session.portal)
    return jsonify(_session_dict(session))


@api_bp.route("/guests/<int:session_id>/reconnect", methods=["POST"])
@require_auth
def reconnect_guest(session_id):
    session = GuestSession.query.get_or_404(session_id)
    _assert_portal_access(session.portal)
    site = session.portal.site
    duration = session.portal.session_duration or 60
    try:
        client = UnifiClient(site.controller)
        client.authorize_guest(site_id=site.unifi_site_id, mac=session.mac_address, minutes=duration)
        return jsonify({"ok": True})
    except UnifiError as e:
        return jsonify({"ok": False, "error": str(e)}), 502


@api_bp.route("/guests/<int:session_id>/unauthorize", methods=["POST"])
@require_auth
def unauthorize_guest(session_id):
    session = GuestSession.query.get_or_404(session_id)
    _assert_portal_access(session.portal)
    site = session.portal.site
    try:
        client = UnifiClient(site.controller)
        client.unauthorize_guest(site_id=site.unifi_site_id, mac=session.mac_address)
        return jsonify({"ok": True})
    except UnifiError as e:
        return jsonify({"ok": False, "error": str(e)}), 502


# ── Device reconnect/unauthorize by MAC (for active devices page) ─────────────

@api_bp.route("/portals/<int:portal_id>/devices/<path:mac>/reconnect", methods=["POST"])
@require_auth
def reconnect_device(portal_id, mac):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal)
    site = portal.site
    duration = portal.session_duration or 60
    try:
        client = UnifiClient(site.controller)
        client.authorize_guest(site_id=site.unifi_site_id, mac=mac.lower(), minutes=duration)
        return jsonify({"ok": True})
    except UnifiError as e:
        return jsonify({"ok": False, "error": str(e)}), 502


@api_bp.route("/portals/<int:portal_id>/devices/<path:mac>/unauthorize", methods=["POST"])
@require_auth
def unauthorize_device(portal_id, mac):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal)
    site = portal.site
    try:
        client = UnifiClient(site.controller)
        client.unauthorize_guest(site_id=site.unifi_site_id, mac=mac.lower())
        return jsonify({"ok": True})
    except UnifiError as e:
        return jsonify({"ok": False, "error": str(e)}), 502


@api_bp.route("/portals/<int:portal_id>/devices/<path:mac>/authorize", methods=["POST"])
@require_auth
def authorize_device(portal_id, mac):
    """Manually authorize a device that's connected (visible in UniFi's
    active-client list) but never completed the captive portal flow - e.g.
    the guest's browser closed before finalize() could run. Unlike
    reconnect_device, this creates a GuestSession row and an audit log
    entry so the device shows up in guest history like any other guest,
    since it never went through the normal form-submit -> finalize() path.
    """
    from app.api.settings import get_setting
    from app.audit import record

    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal)
    site = portal.site
    mac = mac.lower()

    default_duration = int(get_setting("default_session_duration") or 60)
    duration = portal.session_duration or default_duration

    def _kbps(portal_val, setting_key):
        if portal_val and portal_val > 0:
            return portal_val
        try:
            n = int(get_setting(setting_key) or 0)
            return n if n > 0 else None
        except (ValueError, TypeError):
            return None

    rate_down = _kbps(portal.rate_limit_down, "default_rate_limit_down")
    rate_up = _kbps(portal.rate_limit_up, "default_rate_limit_up")

    hostname = ip_address = ssid = ap_mac = None
    try:
        client = UnifiClient(site.controller)
        for c in client.get_active_clients(site_id=site.unifi_site_id):
            if (c.get("mac") or "").lower() == mac:
                hostname = c.get("hostname") or c.get("name")
                ip_address = c.get("ip")
                ssid = c.get("essid")
                ap_mac = c.get("ap_mac")
                break
    except UnifiError:
        pass  # best-effort - still proceed with authorization by MAC

    auth_success = False
    auth_error = None
    status_code = 200
    try:
        client = UnifiClient(site.controller)
        client.authorize_guest(
            site_id=site.unifi_site_id, mac=mac,
            minutes=duration, up_kbps=rate_up, down_kbps=rate_down,
        )
        auth_success = True
    except UnifiError as e:
        auth_error = str(e)
        status_code = 502

    session = GuestSession(
        portal_id=portal.id,
        mac_address=mac,
        hostname=hostname,
        ip_address=ip_address,
        ap_mac=ap_mac,
        ssid=ssid,
        voucher_id=None,
        form_data={},
        auth_success=auth_success,
        auth_error=auth_error,
    )
    db.session.add(session)
    db.session.commit()

    record("guest.manual_authorize", detail={"mac": mac, "portal_id": portal.id})

    if auth_success:
        return jsonify({"ok": True})
    return jsonify({"ok": False, "error": auth_error}), status_code


# ── Export ────────────────────────────────────────────────────────────────────

@api_bp.route("/portals/<int:portal_id>/guests/export", methods=["GET"])
@require_auth
def export_guests(portal_id):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal)

    fields = portal.fields.order_by(PortalField.order).all()
    field_keys = [f.field_key for f in fields]
    field_labels = [f.label for f in fields]

    sessions = GuestSession.query.filter_by(portal_id=portal_id).order_by(
        GuestSession.authorized_at.desc()
    ).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "MAC Address", "IP Address", "SSID", "Auth Success"] + field_labels)
    for s in sessions:
        row = [s.authorized_at.isoformat(), s.mac_address, s.ip_address or "", s.ssid or "", s.auth_success]
        for key in field_keys:
            row.append((s.form_data or {}).get(key, ""))
        writer.writerow(row)

    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename=guests-portal-{portal_id}.csv"},
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _assert_portal_access(portal: Portal):
    user = get_current_user()
    if user.is_superadmin:
        return
    if portal.site.tenant_id != user.tenant_id:
        from flask import abort
        abort(403)


def purge_guest_data() -> int:
    """Delete guest sessions past their configured retention period (portal-
    level data_retention_days, falling back to the global guest_retention_days
    setting). No-op for any portal where neither is set. Shared by the
    `purge-guest-data` CLI command and the scheduler."""
    global_str = db.session.get(PlatformSetting, "guest_retention_days")
    global_days = int(global_str.value) if global_str and global_str.value else None
    total = 0
    for portal in Portal.query.all():
        days = portal.data_retention_days or global_days
        if not days or days <= 0:
            continue
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        n = GuestSession.query.filter(
            GuestSession.portal_id == portal.id,
            GuestSession.authorized_at < cutoff,
        ).delete(synchronize_session=False)
        total += n
    db.session.commit()
    return total


def _unifi_device_dict(c: dict) -> dict:
    return {
        "mac": (c.get("mac") or "").lower(),
        "hostname": c.get("hostname") or c.get("name") or "",
        "ip": c.get("ip") or "",
        "ssid": c.get("essid") or "",
        "ap_mac": c.get("ap_mac") or "",
        "uptime": c.get("uptime"),
        "signal": c.get("signal"),
        "authorized": bool(c.get("authorized")),
    }


def _session_dict(s: GuestSession) -> dict:
    return {
        "id": s.id,
        "portal_id": s.portal_id,
        "mac_address": s.mac_address,
        "ip_address": s.ip_address,
        "ap_mac": s.ap_mac,
        "ssid": s.ssid,
        "form_data": s.form_data or {},
        "auth_success": s.auth_success,
        "auth_error": s.auth_error,
        "authorized_at": s.authorized_at.isoformat(),
        "voucher_id": s.voucher_id,
    }
