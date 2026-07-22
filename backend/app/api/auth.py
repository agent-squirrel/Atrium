from flask import request, jsonify, current_app
from flask_jwt_extended import (
    create_access_token, create_refresh_token,
    jwt_required, get_jwt_identity, decode_token,
)
from datetime import datetime, timezone, timedelta
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from app.extensions import db, limiter
from app.models import User
from . import api_bp
from .decorators import require_auth, get_current_user

_RESET_TOKEN_SALT = "password-reset"
_RESET_TOKEN_MAX_AGE = 3600  # 1 hour

_INVITE_TOKEN_SALT = "account-setup"
_INVITE_TOKEN_MAX_AGE = 3600 * 24 * 7  # 7 days - a standing invite, not a reactive "I forgot" link


def _reset_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=_RESET_TOKEN_SALT)


def _invite_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=_INVITE_TOKEN_SALT)


def _password_fingerprint(user: User) -> str:
    import hashlib
    return hashlib.sha256(user.password_hash.encode()).hexdigest()[:16]


def _refresh_token_expiry() -> timedelta:
    """Refresh token lifetime, driven by the same admin-configurable
    session_remember_days setting used for the 2FA "remember this device"
    duration - one knob for "how long can someone stay logged in". Falls back
    to the fixed JWT_REFRESH_TOKEN_EXPIRES config default if unset/0/invalid,
    since 0 as an actual token lifetime would lock everyone out immediately."""
    from app.api.settings import get_setting
    try:
        days = int(get_setting("session_remember_days"))
    except (TypeError, ValueError):
        days = 0
    if days > 0:
        return timedelta(days=days)
    return current_app.config["JWT_REFRESH_TOKEN_EXPIRES"]


@api_bp.route("/auth/login", methods=["POST"])
@limiter.limit("10 per minute")
def login():
    from app.audit import record
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").lower().strip()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    user = User.query.filter_by(email=email).first()
    if not user or not user.check_password(password):
        record("auth.login_failure", user_email=email, detail={"reason": "invalid_credentials"})
        return jsonify({"error": "Invalid credentials"}), 401

    if not user.is_active:
        return jsonify({"error": "Account disabled"}), 403

    if user.totp_enabled:
        device_token = (data.get("device_token") or "").strip()
        if device_token:
            from app.models import TrustedDevice
            from app.api.settings import get_setting
            days_str = get_setting("session_remember_days")
            days = int(days_str) if days_str else 0
            if days > 0:
                td = TrustedDevice.query.filter_by(token=device_token, user_id=user.id).first()
                if td and not td.is_expired:
                    user.last_login_at = datetime.now(timezone.utc)
                    db.session.commit()
                    record("auth.login_success", user=user, detail={"method": "trusted_device"})
                    return jsonify({
                        "access_token": create_access_token(identity=str(user.id)),
                        "refresh_token": create_refresh_token(identity=str(user.id), expires_delta=_refresh_token_expiry()),
                        "user": _user_payload(user),
                    })

        mfa_token = create_access_token(
            identity=str(user.id),
            expires_delta=timedelta(minutes=5),
            additional_claims={"mfa_pending": True},
        )
        return jsonify({"requires_2fa": True, "mfa_token": mfa_token})

    user.last_login_at = datetime.now(timezone.utc)
    db.session.commit()
    record("auth.login_success", user=user)

    return jsonify({
        "access_token": create_access_token(identity=str(user.id)),
        "refresh_token": create_refresh_token(identity=str(user.id), expires_delta=_refresh_token_expiry()),
        "user": _user_payload(user),
    })


@api_bp.route("/auth/totp/verify", methods=["POST"])
@limiter.limit("5 per minute")
def totp_verify():
    """Complete login for accounts with 2FA enabled."""
    from app.audit import record
    import pyotp

    data = request.get_json(silent=True) or {}
    mfa_token = (data.get("mfa_token") or "").strip()
    code = (data.get("code") or "").strip()

    if not mfa_token or not code:
        return jsonify({"error": "mfa_token and code are required"}), 400

    try:
        decoded = decode_token(mfa_token)
    except Exception:
        return jsonify({"error": "Invalid or expired token"}), 401

    if not decoded.get("mfa_pending"):
        return jsonify({"error": "Invalid token type"}), 400

    user = db.session.get(User, int(decoded["sub"]))
    if not user or not user.is_active or not user.totp_enabled:
        return jsonify({"error": "Unauthorized"}), 401

    if not pyotp.TOTP(user.totp_secret).verify(code, valid_window=1):
        return jsonify({"error": "Invalid code"}), 400

    user.last_login_at = datetime.now(timezone.utc)

    device_token = None
    remember_me = data.get("remember_me", False)
    if remember_me:
        from app.api.settings import get_setting
        days_str = get_setting("session_remember_days")
        days = int(days_str) if days_str else 0
        if days > 0:
            from app.models import TrustedDevice
            device_token = TrustedDevice.generate_token()
            db.session.add(TrustedDevice(
                user_id=user.id,
                token=device_token,
                expires_at=datetime.now(timezone.utc) + timedelta(days=days),
            ))

    db.session.commit()
    record("auth.login_success", user=user, detail={"method": "totp"})

    resp = {
        "access_token": create_access_token(identity=str(user.id)),
        "refresh_token": create_refresh_token(identity=str(user.id), expires_delta=_refresh_token_expiry()),
        "user": _user_payload(user),
    }
    if device_token:
        resp["device_token"] = device_token
    return jsonify(resp)


@api_bp.route("/auth/totp/setup", methods=["POST"])
@require_auth
def totp_setup():
    """Generate a TOTP secret and return the QR code. Does not enable 2FA yet."""
    import pyotp, qrcode, io, base64
    from app.extensions import db

    user = get_current_user()
    secret = pyotp.random_base32()
    user.totp_secret = secret
    db.session.commit()

    issuer = "Atrium"
    uri = pyotp.TOTP(secret).provisioning_uri(user.email, issuer_name=issuer)

    qr = qrcode.QRCode(box_size=8, border=2)
    qr.add_data(uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()

    return jsonify({
        "secret": secret,
        "qr_code": f"data:image/png;base64,{qr_b64}",
        "uri": uri,
    })


@api_bp.route("/auth/totp/enable", methods=["POST"])
@require_auth
def totp_enable():
    """Confirm a TOTP code to activate 2FA on the account."""
    import pyotp
    from app.audit import record

    user = get_current_user()
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip()

    if not user.totp_secret:
        return jsonify({"error": "Call /auth/totp/setup first"}), 400

    if not pyotp.TOTP(user.totp_secret).verify(code, valid_window=1):
        return jsonify({"error": "Invalid code"}), 400

    user.totp_enabled = True
    db.session.commit()
    record("auth.2fa_enabled", user=user)
    return jsonify({"message": "2FA enabled", "totp_enabled": True})


@api_bp.route("/auth/totp/disable", methods=["POST"])
@require_auth
def totp_disable():
    """Disable 2FA after verifying the current TOTP code."""
    import pyotp
    from app.audit import record

    user = get_current_user()
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip()

    if not user.totp_enabled:
        return jsonify({"error": "2FA is not enabled"}), 400

    if not pyotp.TOTP(user.totp_secret).verify(code, valid_window=1):
        return jsonify({"error": "Invalid code"}), 400

    user.totp_enabled = False
    user.totp_secret = None
    db.session.commit()
    record("auth.2fa_disabled", user=user)
    return jsonify({"message": "2FA disabled", "totp_enabled": False})


@api_bp.route("/auth/refresh", methods=["POST"])
@jwt_required(refresh=True)
def refresh():
    user_id = get_jwt_identity()
    user = db.session.get(User, int(user_id))
    if not user or not user.is_active:
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify({"access_token": create_access_token(identity=str(user.id))})


@api_bp.route("/auth/me", methods=["GET"])
@require_auth
def me():
    return jsonify(_user_payload(get_current_user()))


@api_bp.route("/auth/change-password", methods=["POST"])
@require_auth
def change_password():
    user = get_current_user()
    data = request.get_json(silent=True) or {}
    current = data.get("current_password") or ""
    new = data.get("new_password") or ""

    if not user.check_password(current):
        return jsonify({"error": "Current password is incorrect"}), 400
    import re
    def _check(pw):
        if len(pw) < 8: return "Too short - must be at least 8 characters"
        if not re.search(r'\d', pw): return "Must include at least one number (0–9)"
        if not re.search(r'[^a-zA-Z0-9]', pw): return "Must include at least one special character (e.g. ! @ # $)"
    if err := _check(new):
        return jsonify({"error": err}), 400

    user.set_password(new)
    db.session.commit()
    return jsonify({"message": "Password updated"})


@api_bp.route("/auth/forgot-password", methods=["POST"])
@limiter.limit("5 per hour")
def forgot_password():
    from app.audit import record

    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").lower().strip()
    generic = jsonify({"message": "If an account exists for that email, we've sent a password reset link."})

    if not email:
        return generic

    user = User.query.filter_by(email=email).first()
    if not user or not user.is_active:
        return generic

    token = _reset_serializer().dumps({"uid": user.id, "fp": _password_fingerprint(user)})
    reset_url = f"{request.host_url.rstrip('/')}/admin/reset-password?token={token}"

    try:
        from app.mailer import send_email
        send_email(
            user.email,
            "Reset your Atrium password",
            f"A password reset was requested for your Atrium account.\n\n"
            f"Reset your password here (expires in 1 hour):\n{reset_url}\n\n"
            f"If you didn't request this, you can safely ignore this email.",
        )
    except Exception as e:
        record("auth.password_reset_email_failed", user=user, detail={"error": str(e)})
        return generic

    record("auth.password_reset_requested", user=user)
    return generic


@api_bp.route("/auth/reset-password", methods=["POST"])
@limiter.limit("10 per hour")
def reset_password():
    from app.audit import record

    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()
    new = data.get("new_password") or ""

    if not token or not new:
        return jsonify({"error": "token and new_password are required"}), 400

    try:
        payload = _reset_serializer().loads(token, max_age=_RESET_TOKEN_MAX_AGE)
    except SignatureExpired:
        return jsonify({"error": "This reset link has expired. Please request a new one."}), 400
    except BadSignature:
        return jsonify({"error": "Invalid reset link."}), 400

    user = db.session.get(User, payload.get("uid"))
    if not user or not user.is_active or payload.get("fp") != _password_fingerprint(user):
        return jsonify({"error": "This reset link is no longer valid. Please request a new one."}), 400

    from .users import _check_password
    if err := _check_password(new):
        return jsonify({"error": err}), 400

    user.set_password(new)
    db.session.commit()
    record("auth.password_reset_completed", user=user)
    return jsonify({"message": "Password updated. You can now sign in."})


def send_invite_email(user: User) -> None:
    """Emails a newly-created user a link to set their own password, instead
    of an admin setting one for them. Raises on failure (MailerNotConfigured
    or any SMTP error) - unlike forgot_password, which can fail silently
    since the user can just retry later, a failure here means the account
    was created with an unknown/unusable password, so the caller (create_user)
    needs to know and roll back rather than leave it orphaned."""
    token = _invite_serializer().dumps({"uid": user.id, "fp": _password_fingerprint(user)})
    setup_url = f"{request.host_url.rstrip('/')}/admin/setup-account?token={token}"
    from app.mailer import send_email
    send_email(
        user.email,
        "Set up your Atrium account",
        f"You've been added to Atrium. Set your password to finish setting up your account "
        f"(this link expires in 7 days):\n{setup_url}\n\n"
        f"If you weren't expecting this, you can ignore this email.",
    )


@api_bp.route("/auth/setup-account", methods=["POST"])
@limiter.limit("10 per hour")
def setup_account():
    from app.audit import record

    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()
    new = data.get("password") or ""

    if not token or not new:
        return jsonify({"error": "token and password are required"}), 400

    try:
        payload = _invite_serializer().loads(token, max_age=_INVITE_TOKEN_MAX_AGE)
    except SignatureExpired:
        return jsonify({"error": "This setup link has expired. Ask an admin to resend your invite."}), 400
    except BadSignature:
        return jsonify({"error": "Invalid setup link."}), 400

    user = db.session.get(User, payload.get("uid"))
    if not user or not user.is_active or payload.get("fp") != _password_fingerprint(user):
        return jsonify({"error": "This setup link is no longer valid."}), 400

    from .users import _check_password
    if err := _check_password(new):
        return jsonify({"error": err}), 400

    user.set_password(new)
    db.session.commit()
    record("auth.account_setup_completed", user=user)
    return jsonify({"message": "Account set up. You can now sign in."})


def _user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": user.full_name,
        "role": user.role,
        "tenant_id": user.tenant_id,
        "tenant_name": user.tenant.name if user.tenant else None,
        "is_active": user.is_active,
        "totp_enabled": user.totp_enabled,
        "memberships": [
            {
                "id": m.id,
                "user_id": m.user_id,
                "tenant_id": m.tenant_id,
                "tenant_name": m.tenant.name if m.tenant else None,
                "role": m.role,
            }
            for m in user.memberships
        ],
    }
