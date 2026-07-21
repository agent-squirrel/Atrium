from flask import request, jsonify
from app.extensions import db
from app.models import Tenant, UnifiController, UnifiSite, User, ControllerOwnerType
from . import api_bp
from .decorators import require_superadmin, require_admin, get_current_user, require_auth


@api_bp.route("/tenants", methods=["GET"])
@require_admin
def list_tenants():
    user = get_current_user()
    if user.is_superadmin:
        tenants = Tenant.query.order_by(Tenant.name).all()
    else:
        tenants = [user.tenant] if user.tenant else []
    return jsonify([_tenant_dict(t) for t in tenants])


@api_bp.route("/tenants", methods=["POST"])
@require_superadmin
def create_tenant():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400

    tenant = Tenant(name=name)
    db.session.add(tenant)
    db.session.commit()
    return jsonify(_tenant_dict(tenant)), 201


@api_bp.route("/tenants/<int:tenant_id>", methods=["GET"])
@require_auth
def get_tenant(tenant_id):
    user = get_current_user()
    tenant = Tenant.query.get_or_404(tenant_id)
    if not user.is_superadmin and user.tenant_id != tenant_id:
        return jsonify({"error": "Forbidden"}), 403
    return jsonify(_tenant_dict(tenant))


@api_bp.route("/tenants/<int:tenant_id>", methods=["PUT"])
@require_admin
def update_tenant(tenant_id):
    user = get_current_user()
    if not user.is_superadmin and user.tenant_id != tenant_id:
        return jsonify({"error": "Forbidden"}), 403
    tenant = Tenant.query.get_or_404(tenant_id)
    data = request.get_json(silent=True) or {}
    if "name" in data and data["name"].strip():
        tenant.name = data["name"].strip()
    if "is_active" in data:
        tenant.is_active = bool(data["is_active"])
    db.session.commit()
    return jsonify(_tenant_dict(tenant))


@api_bp.route("/tenants/<int:tenant_id>", methods=["DELETE"])
@require_superadmin
def delete_tenant(tenant_id):
    """Deleting a tenant reallocates everything it owns to the platform
    (tenant_id -> NULL) rather than deleting those assets - controllers,
    sites, and the portals under them keep working, just unscoped from any
    tenant. Tenant membership rows are removed automatically by the DB
    (ON DELETE CASCADE); Portal has no tenant_id of its own, so nothing to
    do there - it inherits ownership from its site."""
    tenant = Tenant.query.get_or_404(tenant_id)
    name = tenant.name

    controllers_n = UnifiController.query.filter_by(tenant_id=tenant_id).update(
        {"tenant_id": None, "owner_type": ControllerOwnerType.PLATFORM},
        synchronize_session=False,
    )
    sites_n = UnifiSite.query.filter_by(tenant_id=tenant_id).update(
        {"tenant_id": None}, synchronize_session=False,
    )
    users_n = User.query.filter_by(tenant_id=tenant_id).update(
        {"tenant_id": None}, synchronize_session=False,
    )

    db.session.delete(tenant)
    db.session.commit()

    from app.audit import record
    record(
        "tenant.delete",
        resource_type="tenant",
        resource_id=tenant_id,
        detail={
            "name": name,
            "reassigned_controllers": controllers_n,
            "reassigned_sites": sites_n,
            "reassigned_users": users_n,
        },
    )
    return "", 204


def _tenant_dict(t: Tenant) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "slug": t.slug,
        "is_active": t.is_active,
        "created_at": t.created_at.isoformat(),
    }
