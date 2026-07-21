from functools import wraps
from flask import jsonify
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
from app.models import User, UserRole
from app.extensions import db


def _current_user() -> User | None:
    identity = get_jwt_identity()
    return db.session.get(User, int(identity)) if identity else None


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        verify_jwt_in_request()
        from flask_jwt_extended import get_jwt
        if get_jwt().get("mfa_pending"):
            return jsonify({"error": "2FA verification required"}), 401
        user = _current_user()
        if not user or not user.is_active:
            return jsonify({"error": "Unauthorized"}), 401
        return fn(*args, **kwargs)
    return wrapper


def require_role(*roles):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            user = _current_user()
            if not user or not user.is_active:
                return jsonify({"error": "Unauthorized"}), 401
            if user.role not in roles:
                return jsonify({"error": "Forbidden"}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def require_superadmin(fn):
    return require_role(UserRole.SUPERADMIN)(fn)


def require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        verify_jwt_in_request()
        from flask_jwt_extended import get_jwt
        if get_jwt().get("mfa_pending"):
            return jsonify({"error": "2FA verification required"}), 401
        user = _current_user()
        if not user or not user.is_active:
            return jsonify({"error": "Unauthorized"}), 401
        if user.role in (UserRole.SUPERADMIN, UserRole.ADMIN):
            return fn(*args, **kwargs)
        from app.models import UserTenantMembership
        if db.session.query(UserTenantMembership).filter_by(
            user_id=user.id, role="admin"
        ).first():
            return fn(*args, **kwargs)
        return jsonify({"error": "Forbidden"}), 403
    return wrapper


def get_current_user() -> User | None:
    try:
        verify_jwt_in_request()
        return _current_user()
    except Exception:
        return None


def tenant_access_required(tenant_id_kwarg="tenant_id"):
    """
    Ensures the current user has access to the given tenant.
    Superadmins pass through; admins and clients must own that tenant.
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            user = _current_user()
            if not user or not user.is_active:
                return jsonify({"error": "Unauthorized"}), 401
            if not user.is_superadmin:
                tid = kwargs.get(tenant_id_kwarg)
                if str(user.tenant_id) != str(tid):
                    return jsonify({"error": "Forbidden"}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator
