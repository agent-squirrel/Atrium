from flask import request, jsonify, Response, current_app
from app.extensions import db
from app.models import PlatformSetting, GuestSession, Portal, EmailSettings, EmailEncryption
from app.backup import _current_schema_revision
from . import api_bp
from .decorators import require_superadmin, require_auth, get_current_user
from datetime import datetime, timezone, timedelta
from zoneinfo import available_timezones

SETTING_DEFS = {
    "default_session_duration": {
        "default": "60",
        "description": "Default guest session length in minutes when a portal has no specific duration set.",
    },
    "default_rate_limit_down": {
        "default": "",
        "description": "Default download speed limit in kbps for all portals. Leave blank for no limit.",
    },
    "default_rate_limit_up": {
        "default": "",
        "description": "Default upload speed limit in kbps for all portals. Leave blank for no limit.",
    },
    "guest_retention_days": {
        "default": "",
        "description": "Delete guest session records older than this many days. Leave blank to keep data forever.",
    },
    "maintenance_mode": {
        "default": "false",
        "description": "When enabled, all guest-facing portals display a maintenance message instead of the normal form.",
    },
    "root_redirect_url": {
        "default": "",
        "description": "Redirect visitors who hit the root URL (/) to this address. Leave blank to load the admin panel at /admin.",
    },
    "admin_allowed_ips": {
        "default": "",
        "description": (
            "CIDR ranges that are permitted to access the admin API (one per line). "
            "Leave blank to allow all IPs. "
            "WARNING: setting this incorrectly will lock you out of the admin panel."
        ),
    },
    "session_remember_days": {
        "default": "3",
        "description": "How many days you stay logged in before needing to sign in again.",
    },
    "timezone": {
        "default": "UTC",
        "description": "Timezone used to display dates and times throughout the admin panel.",
    },
    "date_format": {
        "default": "MM/DD/YYYY",
        "description": "Date order used to display dates and times throughout the admin panel.",
    },
}

DATE_FORMATS = ("MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD")


def get_setting(key: str) -> str:
    """Return the stored value for key, or the SETTING_DEFS default."""
    s = db.session.get(PlatformSetting, key)
    if s and s.value is not None:
        return s.value
    return SETTING_DEFS.get(key, {}).get("default", "")



@api_bp.route("/settings/my-ip", methods=["GET"])
def get_my_ip():
    """Returns the client IP as seen by the server - useful when configuring IP restrictions."""
    ip = request.headers.get("X-Real-IP") or request.remote_addr or "unknown"
    return jsonify({"ip": ip})


@api_bp.route("/settings/display", methods=["GET"])
@require_auth
def get_display_settings():
    """Exposes just the display prefs (timezone, date format) to any
    signed-in user (not just superadmins) - every role needs these to
    render dates correctly, unlike the rest of /settings which contains
    superadmin-only configuration."""
    return jsonify({
        "timezone": get_setting("timezone"),
        "date_format": get_setting("date_format"),
    })


@api_bp.route("/settings/version", methods=["GET"])
@require_superadmin
def get_version():
    """App version and schema revision, shown in Settings so an admin can
    tell what they're running - most useful when a backup/restore fails
    and they need to check for a version mismatch (the restore itself
    checks the exact schema_revision independently, see app/backup.py)."""
    return jsonify({
        "app_version": current_app.config["APP_VERSION"],
        "schema_revision": _current_schema_revision(),
    })


@api_bp.route("/settings", methods=["GET"])
@require_superadmin
def get_settings():
    rows = {s.key: s.value for s in PlatformSetting.query.all()}
    result = {}
    for key, meta in SETTING_DEFS.items():
        result[key] = {
            "value": rows.get(key) if rows.get(key) is not None else meta["default"],
            "description": meta["description"],
        }
    return jsonify(result)


@api_bp.route("/settings", methods=["PUT"])
@require_superadmin
def update_settings():
    data = request.get_json(silent=True) or {}

    tz = data.get("timezone")
    if tz and tz.strip() and tz.strip() not in available_timezones():
        return jsonify({"error": f"Unknown timezone: {tz}"}), 400

    date_format = data.get("date_format")
    if date_format and date_format.strip() and date_format.strip() not in DATE_FORMATS:
        return jsonify({"error": f"Unknown date format: {date_format}"}), 400

    for key, value in data.items():
        if key not in SETTING_DEFS:
            continue
        v = (value or "").strip() or None
        setting = db.session.get(PlatformSetting, key)
        if setting:
            setting.value = v
        else:
            db.session.add(PlatformSetting(key=key, value=v))
    db.session.commit()
    from app.audit import record
    changed = {k: v for k, v in data.items() if k in SETTING_DEFS}
    record("settings.update", detail={"values": changed})
    return get_settings()


@api_bp.route("/settings/purge-guests", methods=["POST"])
@require_superadmin
def purge_guests():
    """Delete guest sessions that exceed their retention period."""
    global_days_str = get_setting("guest_retention_days")
    global_days = int(global_days_str) if global_days_str else None

    total_deleted = 0
    for portal in Portal.query.all():
        days = portal.data_retention_days or global_days
        if not days or days <= 0:
            continue
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        deleted = GuestSession.query.filter(
            GuestSession.portal_id == portal.id,
            GuestSession.authorized_at < cutoff,
        ).delete(synchronize_session=False)
        total_deleted += deleted

    db.session.commit()
    return jsonify({"deleted": total_deleted})


@api_bp.route("/settings/email", methods=["GET"])
@require_superadmin
def get_email_settings():
    s = EmailSettings.get_or_create()
    return jsonify({
        "enabled": s.enabled,
        "smtp_host": s.smtp_host or "",
        "smtp_port": s.smtp_port,
        "smtp_username": s.smtp_username or "",
        "has_password": bool(s._smtp_password_encrypted),
        "from_address": s.from_address or "",
        "from_name": s.from_name or "",
        "encryption": s.encryption,
    })


@api_bp.route("/settings/email", methods=["PUT"])
@require_superadmin
def update_email_settings():
    data = request.get_json(silent=True) or {}
    s = EmailSettings.get_or_create()

    if "enabled" in data:
        s.enabled = bool(data["enabled"])
    if "smtp_host" in data:
        s.smtp_host = (data["smtp_host"] or "").strip() or None
    if "smtp_port" in data:
        try:
            s.smtp_port = int(data["smtp_port"]) if data["smtp_port"] else None
        except (TypeError, ValueError):
            return jsonify({"error": "smtp_port must be a number"}), 400
    if "smtp_username" in data:
        s.smtp_username = (data["smtp_username"] or "").strip() or None
    if "password" in data and data["password"]:
        s.smtp_password = data["password"]
    if "from_address" in data:
        s.from_address = (data["from_address"] or "").strip() or None
    if "from_name" in data:
        s.from_name = (data["from_name"] or "").strip() or None
    if "encryption" in data:
        if data["encryption"] not in EmailEncryption.ALL:
            return jsonify({"error": "Invalid encryption mode"}), 400
        s.encryption = data["encryption"]

    db.session.commit()
    from app.audit import record
    record("settings.email_update", detail={
        "enabled": s.enabled,
        "smtp_host": s.smtp_host,
        "smtp_port": s.smtp_port,
        "smtp_username": s.smtp_username,
        "from_address": s.from_address,
        "from_name": s.from_name,
        "encryption": s.encryption,
        "password_changed": bool("password" in data and data["password"]),
    })
    return get_email_settings()


@api_bp.route("/settings/email/test", methods=["POST"])
@require_superadmin
def test_email_settings():
    from app.mailer import send_email, MailerNotConfigured

    data = request.get_json(silent=True) or {}
    user = get_current_user()
    to = (data.get("to") or "").strip() or (user.email if user else "")
    if not to:
        return jsonify({"ok": False, "message": "No destination address"}), 400

    try:
        send_email(to, "Atrium test email", "This is a test email from your Atrium admin panel. If you received this, SMTP is configured correctly.")
        return jsonify({"ok": True, "message": f"Test email sent to {to}"})
    except MailerNotConfigured as e:
        return jsonify({"ok": False, "message": str(e)}), 400
    except Exception as e:
        return jsonify({"ok": False, "message": f"Failed to send: {e}"}), 502


@api_bp.route("/settings/backup", methods=["POST"])
@require_superadmin
def download_backup():
    from app.backup import create_backup

    data = request.get_json(silent=True) or {}
    password = (data.get("password") or "").strip() or None

    backup_bytes = create_backup(password)
    filename = f"atrium-backup-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.atriumbak"

    from app.audit import record
    record("settings.backup_downloaded", detail={"encrypted": password is not None})

    return Response(
        backup_bytes,
        mimetype="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
