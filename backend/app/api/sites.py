from flask import request, jsonify
from app.extensions import db
from app.models import UnifiSite, Tenant, UnifiController, ControllerOwnerType
from app.services.unifi import UnifiClient, UnifiError
from . import api_bp
from .decorators import require_superadmin, require_admin, require_auth, get_current_user


@api_bp.route("/sites", methods=["GET"])
@require_auth
def list_sites():
    user = get_current_user()
    q = UnifiSite.query
    if not user.is_superadmin:
        from app.models import UserTenantMembership
        extra = [m.tenant_id for m in UserTenantMembership.query.filter_by(user_id=user.id)]
        tenant_ids = list({user.tenant_id, *extra} - {None})
        q = q.filter(UnifiSite.tenant_id.in_(tenant_ids))
    sites = q.order_by(UnifiSite.name).all()
    return jsonify([_site_dict(s) for s in sites])


@api_bp.route("/sites/<int:site_id>", methods=["GET"])
@require_auth
def get_site(site_id):
    site = UnifiSite.query.get_or_404(site_id)
    _assert_site_access(site)
    return jsonify(_site_dict(site))


@api_bp.route("/sites/<int:site_id>", methods=["PUT"])
@require_admin
def update_site(site_id):
    site = UnifiSite.query.get_or_404(site_id)
    _assert_site_access(site, need_admin=True)
    data = request.get_json(silent=True) or {}

    if "name" in data and data["name"].strip():
        site.name = data["name"].strip()
    if "description" in data:
        site.description = data["description"]
    if "is_active" in data:
        site.is_active = bool(data["is_active"])

    # Only superadmins can reassign a site to a different tenant
    user = get_current_user()
    if "tenant_id" in data and user.is_superadmin:
        tid = data["tenant_id"]
        if tid and not Tenant.query.get(tid):
            return jsonify({"error": "Tenant not found"}), 404
        site.tenant_id = tid

    db.session.commit()
    return jsonify(_site_dict(site))


@api_bp.route("/sites/<int:site_id>/portals", methods=["GET"])
@require_auth
def list_site_portals(site_id):
    site = UnifiSite.query.get_or_404(site_id)
    _assert_site_access(site)
    portals = site.portals.order_by("name").all()
    return jsonify([_portal_brief(p) for p in portals])


@api_bp.route("/sites/<int:site_id>/ssids", methods=["GET"])
@require_auth
def get_site_ssids(site_id):
    site = UnifiSite.query.get_or_404(site_id)
    _assert_site_access(site)
    try:
        client = UnifiClient(site.controller)
        return jsonify({"ssids": client.get_ssid_names(site.unifi_site_id)})
    except UnifiError as e:
        return jsonify({"ssids": [], "error": str(e)}), 502


def _tenant_role(user, tenant_id: int) -> str | None:
    if user.is_superadmin:
        return "superadmin"
    if user.tenant_id == tenant_id:
        return user.role
    from app.models import UserTenantMembership
    m = UserTenantMembership.query.filter_by(user_id=user.id, tenant_id=tenant_id).first()
    return m.role if m else None


def _assert_site_access(site: UnifiSite, need_admin: bool = False):
    from flask import abort
    user = get_current_user()
    role = _tenant_role(user, site.tenant_id)
    if role is None:
        abort(403)
    if need_admin and role not in ("superadmin", "admin"):
        abort(403)


def _site_dict(s: UnifiSite) -> dict:
    return {
        "id": s.id,
        "unifi_site_id": s.unifi_site_id,
        "name": s.name,
        "description": s.description,
        "controller_id": s.controller_id,
        "controller_name": s.controller.name if s.controller else None,
        "tenant_id": s.tenant_id,
        "tenant_name": s.tenant.name if s.tenant else None,
        "is_active": s.is_active,
        "created_at": s.created_at.isoformat(),
        "portal_count": s.portals.count(),
    }


def _portal_brief(p) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "slug": p.slug,
        "ssids": p.ssids or [],
        "auth_type": p.auth_type,
        "is_active": p.is_active,
    }
