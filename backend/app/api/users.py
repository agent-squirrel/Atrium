import re
from flask import request, jsonify
from app.extensions import db
from app.models import User, UserRole, Tenant, UserTenantMembership
from . import api_bp
from .decorators import require_superadmin, require_admin, get_current_user, require_auth


def _check_password(pw: str) -> str | None:
    if len(pw) < 8:
        return "Too short - must be at least 8 characters"
    if not re.search(r'\d', pw):
        return "Must include at least one number (0–9)"
    if not re.search(r'[^a-zA-Z0-9]', pw):
        return "Must include at least one special character (e.g. ! @ # $)"
    return None


def _actor_admin_tenant_ids(actor: User) -> set[int]:
    """Tenant IDs where actor has admin-level write access."""
    ids: set[int] = set()
    if actor.is_superadmin:
        return ids  # caller should skip filtering entirely
    if actor.tenant_id and actor.role == UserRole.ADMIN:
        ids.add(actor.tenant_id)
    for m in UserTenantMembership.query.filter_by(user_id=actor.id, role="admin"):
        ids.add(m.tenant_id)
    return ids


def _actor_can_manage(actor: User, target_tenant_id: int | None) -> bool:
    """True if actor has admin-level access to the given tenant."""
    if actor.is_superadmin:
        return True
    if target_tenant_id is None:
        return False
    return target_tenant_id in _actor_admin_tenant_ids(actor)


@api_bp.route("/users", methods=["GET"])
@require_admin
def list_users():
    actor = get_current_user()
    q = User.query
    if not actor.is_superadmin:
        tenant_ids = list(_actor_admin_tenant_ids(actor))
        q = q.filter(User.tenant_id.in_(tenant_ids))
    users = q.order_by(User.email).all()
    return jsonify([_user_dict(u) for u in users])


@api_bp.route("/users", methods=["POST"])
@require_admin
def create_user():
    actor = get_current_user()
    data = request.get_json(silent=True) or {}

    email = (data.get("email") or "").lower().strip()
    password = data.get("password") or ""
    send_invite = bool(data.get("send_invite")) and not password
    role = data.get("role", UserRole.CLIENT)
    tenant_id = data.get("tenant_id")

    if not email:
        return jsonify({"error": "Email is required"}), 400

    if not password and not send_invite:
        return jsonify({"error": "Password is required"}), 400

    if send_invite:
        from app.models import EmailSettings
        if not EmailSettings.get_or_create().enabled:
            return jsonify({"error": "Email is not configured - set a password for this user instead."}), 400

    if password and (err := _check_password(password)):
        return jsonify({"error": err}), 400

    if role not in UserRole.ALL:
        return jsonify({"error": f"Role must be one of: {UserRole.ALL}"}), 400

    if actor.is_superadmin:
        if role == UserRole.SUPERADMIN:
            tenant_id = None
        # else use whatever tenant_id was passed (can be None)
    else:
        if role == UserRole.SUPERADMIN:
            return jsonify({"error": "Forbidden"}), 403

        allowed = _actor_admin_tenant_ids(actor)
        if not allowed:
            return jsonify({"error": "Forbidden"}), 403

        if tenant_id:
            if int(tenant_id) not in allowed:
                return jsonify({"error": "Forbidden - you do not have admin access to that tenant"}), 403
            tenant_id = int(tenant_id)
        else:
            if len(allowed) == 1:
                tenant_id = next(iter(allowed))
            else:
                return jsonify({"error": "tenant_id is required - specify which tenant to add the user to"}), 400

    if tenant_id and not db.session.get(Tenant, tenant_id):
        return jsonify({"error": "Tenant not found"}), 404

    if User.query.filter_by(email=email).first():
        return jsonify({"error": "Email already registered"}), 409

    new_user = User(
        email=email,
        role=role,
        tenant_id=tenant_id,
        first_name=data.get("first_name", "").strip() or None,
        last_name=data.get("last_name", "").strip() or None,
    )
    if password:
        new_user.set_password(password)
    else:
        # Invited: nobody knows this password, including the admin creating
        # the account - it only ever gets replaced via the setup-account
        # link. password_hash is NOT NULL, so a real (if unusable) hash is
        # required rather than leaving it blank.
        import secrets
        new_user.set_password(secrets.token_urlsafe(32))
    db.session.add(new_user)
    db.session.flush()  # assign an id (needed for the invite token) without committing yet

    if send_invite:
        try:
            from .auth import send_invite_email
            send_invite_email(new_user)
        except Exception as e:
            db.session.rollback()
            return jsonify({"error": f"Could not send invite email: {e}. Set a password instead, or check email settings."}), 502

    db.session.commit()
    from app.audit import record
    record("user.create", resource_type="user", resource_id=new_user.id,
           detail={"email": email, "role": role, "invited": send_invite})
    return jsonify(_user_dict(new_user)), 201


@api_bp.route("/users/<int:user_id>", methods=["GET"])
@require_auth
def get_user(user_id):
    actor = get_current_user()
    target = User.query.get_or_404(user_id)
    if actor.id != target.id and not _actor_can_manage(actor, target.tenant_id):
        return jsonify({"error": "Forbidden"}), 403
    return jsonify(_user_dict(target))


@api_bp.route("/users/<int:user_id>", methods=["PUT"])
@require_admin
def update_user(user_id):
    actor = get_current_user()
    target = User.query.get_or_404(user_id)

    if not _actor_can_manage(actor, target.tenant_id):
        return jsonify({"error": "Forbidden"}), 403

    data = request.get_json(silent=True) or {}

    if "first_name" in data:
        target.first_name = (data["first_name"] or "").strip() or None
    if "last_name" in data:
        target.last_name = (data["last_name"] or "").strip() or None
    if "is_active" in data:
        target.is_active = bool(data["is_active"])

    if "role" in data:
        new_role = data["role"]
        if actor.is_superadmin:
            if new_role not in UserRole.ALL:
                return jsonify({"error": "Invalid role"}), 400
            target.role = new_role
            if new_role == UserRole.SUPERADMIN:
                target.tenant_id = None
        else:
            # Admins can change roles within their tenant but cannot create superadmins
            if new_role == UserRole.SUPERADMIN:
                return jsonify({"error": "Forbidden"}), 403
            if new_role not in UserRole.ALL:
                return jsonify({"error": "Invalid role"}), 400
            target.role = new_role

    if "tenant_id" in data and actor.is_superadmin:
        tid = data["tenant_id"]
        if tid and not db.session.get(Tenant, int(tid)):
            return jsonify({"error": "Tenant not found"}), 404
        target.tenant_id = int(tid) if tid else None

    if "password" in data and data["password"]:
        if err := _check_password(data["password"]):
            return jsonify({"error": err}), 400
        target.set_password(data["password"])

    db.session.commit()
    from app.audit import record
    record("user.update", resource_type="user", resource_id=target.id,
           detail={"email": target.email})
    return jsonify(_user_dict(target))


@api_bp.route("/users/<int:user_id>", methods=["DELETE"])
@require_admin
def delete_user(user_id):
    actor = get_current_user()
    target = User.query.get_or_404(user_id)
    if not _actor_can_manage(actor, target.tenant_id):
        return jsonify({"error": "Forbidden"}), 403
    if target.id == actor.id:
        return jsonify({"error": "Cannot delete your own account"}), 400
    from app.audit import record
    email, uid = target.email, target.id
    db.session.delete(target)
    db.session.commit()
    record("user.delete", resource_type="user", resource_id=uid, detail={"email": email})
    return "", 204


@api_bp.route("/users/<int:user_id>/memberships", methods=["POST"])
@require_superadmin
def add_membership(user_id):
    target = db.session.get(User, user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json(silent=True) or {}
    tenant_id = data.get("tenant_id")
    role = data.get("role", "client")

    if not tenant_id:
        return jsonify({"error": "tenant_id required"}), 400
    if role not in ("admin", "client"):
        return jsonify({"error": "role must be admin or client"}), 400
    if not db.session.get(Tenant, tenant_id):
        return jsonify({"error": "Tenant not found"}), 404

    existing = UserTenantMembership.query.filter_by(user_id=user_id, tenant_id=tenant_id).first()
    if existing:
        existing.role = role
        m = existing
    else:
        m = UserTenantMembership(user_id=user_id, tenant_id=tenant_id, role=role)
        db.session.add(m)

    db.session.commit()
    return jsonify(_membership_dict(m)), 201


@api_bp.route("/users/<int:user_id>/memberships/<int:membership_id>", methods=["DELETE"])
@require_superadmin
def remove_membership(user_id, membership_id):
    m = UserTenantMembership.query.filter_by(id=membership_id, user_id=user_id).first_or_404()
    db.session.delete(m)
    db.session.commit()
    return "", 204


def _membership_dict(m: UserTenantMembership) -> dict:
    return {
        "id": m.id,
        "user_id": m.user_id,
        "tenant_id": m.tenant_id,
        "tenant_name": m.tenant.name if m.tenant else None,
        "role": m.role,
    }


def _user_dict(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "first_name": u.first_name,
        "last_name": u.last_name,
        "full_name": u.full_name,
        "role": u.role,
        "tenant_id": u.tenant_id,
        "tenant_name": u.tenant.name if u.tenant else None,
        "is_active": u.is_active,
        "created_at": u.created_at.isoformat(),
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        "memberships": [_membership_dict(m) for m in u.memberships],
    }
