from flask import request, jsonify
from flask_jwt_extended import create_access_token, create_refresh_token
from datetime import datetime, timezone
from zoneinfo import available_timezones
from app.extensions import db
from app.models import User, PlatformSetting
from app.models.user import UserRole
from . import api_bp


@api_bp.route("/setup/status", methods=["GET"])
def setup_status():
    has_superadmin = User.query.filter_by(role=UserRole.SUPERADMIN).first() is not None
    return jsonify({"needs_setup": not has_superadmin})


@api_bp.route("/setup/complete", methods=["POST"])
def setup_complete():
    if User.query.filter_by(role=UserRole.SUPERADMIN).first():
        return jsonify({"error": "Setup has already been completed"}), 403

    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").lower().strip()
    password = data.get("password") or ""
    first_name = (data.get("first_name") or "").strip() or None
    last_name = (data.get("last_name") or "").strip() or None

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({"error": "An account with that email already exists"}), 409

    tz = (data.get("timezone") or "").strip()
    if tz and tz not in available_timezones():
        return jsonify({"error": f"Unknown timezone: {tz}"}), 400

    from app.api.settings import DATE_FORMATS
    date_format = (data.get("date_format") or "").strip()
    if date_format and date_format not in DATE_FORMATS:
        return jsonify({"error": f"Unknown date format: {date_format}"}), 400

    user = User(
        email=email,
        first_name=first_name,
        last_name=last_name,
        role=UserRole.SUPERADMIN,
        is_active=True,
        last_login_at=datetime.now(timezone.utc),
    )
    user.set_password(password)
    db.session.add(user)
    if tz:
        db.session.add(PlatformSetting(key="timezone", value=tz))
    if date_format:
        db.session.add(PlatformSetting(key="date_format", value=date_format))
    db.session.commit()

    access_token = create_access_token(identity=str(user.id))
    refresh_token = create_refresh_token(identity=str(user.id))

    return jsonify({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": {
            "id": user.id,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "full_name": user.full_name,
            "role": user.role,
            "tenant_id": user.tenant_id,
            "is_active": user.is_active,
        },
    }), 201


@api_bp.route("/setup/restore", methods=["POST"])
def setup_restore():
    from app.backup import restore_backup, BackupError
    from app.audit import record

    if "file" not in request.files:
        return jsonify({"error": "No backup file provided"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "No backup file provided"}), 400

    password = (request.form.get("password") or "").strip() or None

    try:
        restore_backup(file.read(), password)
    except BackupError as e:
        return jsonify({"error": str(e)}), 400

    record("setup.restored")
    return jsonify({"message": "Restore complete. Sign in with your restored credentials."})
