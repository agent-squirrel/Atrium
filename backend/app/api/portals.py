from flask import request, jsonify, current_app
from app.extensions import db
from app.models import Portal, PortalField, UnifiSite, AuthType, FieldType, Layout, GOOGLE_FONTS
from app.services.unifi import UnifiClient, UnifiError
from . import api_bp
from .decorators import require_admin, require_auth, get_current_user


@api_bp.route("/portals", methods=["GET"])
@require_auth
def list_portals():
    user = get_current_user()
    q = Portal.query.join(UnifiSite)
    if not user.is_superadmin:
        from app.models import UserTenantMembership
        extra = [m.tenant_id for m in UserTenantMembership.query.filter_by(user_id=user.id)]
        tenant_ids = list({user.tenant_id, *extra} - {None})
        q = q.filter(UnifiSite.tenant_id.in_(tenant_ids))
    portals = q.order_by(Portal.name).all()
    return jsonify([_portal_dict(p) for p in portals])


@api_bp.route("/portals", methods=["POST"])
@require_admin
def create_portal():
    data = request.get_json(silent=True) or {}

    name = (data.get("name") or "").strip()
    site_id = data.get("site_id")
    auth_type = data.get("auth_type", AuthType.CLICK_THROUGH)

    if not name or not site_id:
        return jsonify({"error": "name and site_id are required"}), 400

    site = UnifiSite.query.get_or_404(site_id)
    _assert_site_access(site, need_admin=True)

    if auth_type not in AuthType.ALL:
        return jsonify({"error": f"auth_type must be one of: {AuthType.ALL}"}), 400

    ssids = data.get("ssids")
    if not isinstance(ssids, list):
        ssids = []

    portal = Portal(
        name=name,
        site_id=site_id,
        auth_type=auth_type,
        ssids=[s for s in ssids if isinstance(s, str) and s],
        welcome_heading=data.get("welcome_heading", "Welcome"),
        welcome_text=data.get("welcome_text"),
        disclaimer=data.get("disclaimer"),
        button_label=data.get("button_label", "Connect"),
        primary_color=data.get("primary_color", "#3B82F6"),
        secondary_color=data.get("secondary_color", "#1E40AF"),
        redirect_url=data.get("redirect_url"),
        session_duration=data.get("session_duration", 0),
    )
    db.session.add(portal)
    db.session.commit()
    from app.audit import record
    record("portal.create", resource_type="portal", resource_id=portal.id,
           detail={"name": portal.name})
    return jsonify(_portal_dict(portal)), 201


@api_bp.route("/portals/<int:portal_id>", methods=["GET"])
@require_auth
def get_portal(portal_id):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal)
    return jsonify(_portal_dict(portal, include_fields=True))


@api_bp.route("/portals/<int:portal_id>", methods=["PUT"])
@require_admin
def update_portal(portal_id):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal, need_admin=True)
    data = request.get_json(silent=True) or {}

    # Nullable integer fields - empty string from form inputs means None
    nullable_ints = {"rate_limit_down", "rate_limit_up", "data_retention_days"}
    # Non-nullable integer fields - empty string means 0
    nonnull_ints = {"session_duration"}
    # Non-nullable integer fields with a non-zero fallback when blank
    default_ints = {"connect_delay_seconds": 5, "card_opacity": 97}

    updatable = [
        "name", "auth_type", "ssids", "welcome_heading", "welcome_text",
        "disclaimer", "button_label", "primary_color", "secondary_color",
        "font_family", "layout", "card_opacity",
        "require_terms_acceptance", "terms_checkbox_label", "terms_url",
        "social_facebook", "social_instagram", "social_twitter_x", "social_tiktok",
        "post_connect_heading", "post_connect_text", "promo_banner_link",
        "redirect_url", "connect_delay_seconds",
        "session_duration", "is_active", "maintenance_mode",
        "rate_limit_down", "rate_limit_up", "data_retention_days",
    ]
    old_vals = {f: getattr(portal, f) for f in updatable}
    for field in updatable:
        if field in data:
            if field == "auth_type" and data[field] not in AuthType.ALL:
                return jsonify({"error": f"auth_type must be one of: {AuthType.ALL}"}), 400
            if field == "layout" and data[field] not in Layout.ALL:
                return jsonify({"error": f"layout must be one of: {Layout.ALL}"}), 400
            if field == "font_family" and data[field] and data[field] not in GOOGLE_FONTS:
                return jsonify({"error": f"font_family must be one of: {GOOGLE_FONTS}"}), 400
            val = data[field]
            if field == "ssids":
                if not isinstance(val, list):
                    return jsonify({"error": "ssids must be a list"}), 400
                val = [s for s in val if isinstance(s, str) and s]
            elif field in nullable_ints:
                val = int(val) if val not in (None, "", 0) else None
            elif field in nonnull_ints:
                val = int(val) if val not in (None, "") else 0
            elif field in default_ints:
                val = int(val) if val not in (None, "") else default_ints[field]
                if field == "card_opacity" and not (0 <= val <= 100):
                    return jsonify({"error": "card_opacity must be between 0 and 100"}), 400
            setattr(portal, field, val)

    changes = {
        f: {"from": old_vals[f], "to": getattr(portal, f)}
        for f in updatable
        if getattr(portal, f) != old_vals[f]
    }
    db.session.commit()
    from app.audit import record
    record("portal.update", resource_type="portal", resource_id=portal.id,
           detail={"name": portal.name, "changes": changes})
    return jsonify(_portal_dict(portal, include_fields=True))


@api_bp.route("/portals/<int:portal_id>", methods=["DELETE"])
@require_admin
def delete_portal(portal_id):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal, need_admin=True)
    from app.audit import record
    name, pid = portal.name, portal.id
    db.session.delete(portal)
    db.session.commit()
    record("portal.delete", resource_type="portal", resource_id=pid, detail={"name": name})
    return "", 204


@api_bp.route("/portals/<int:portal_id>/ssids", methods=["GET"])
@require_auth
def get_portal_ssids(portal_id):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal)
    try:
        client = UnifiClient(portal.site.controller)
        return jsonify({"ssids": client.get_ssid_names(portal.site.unifi_site_id)})
    except UnifiError as e:
        return jsonify({"ssids": [], "error": str(e)}), 502


# ── Field management ────────────────────────────────────────────────────────


@api_bp.route("/portals/<int:portal_id>/fields", methods=["GET"])
@require_auth
def list_fields(portal_id):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal)
    fields = portal.fields.order_by(PortalField.order).all()
    return jsonify([_field_dict(f) for f in fields])


@api_bp.route("/portals/<int:portal_id>/fields", methods=["POST"])
@require_admin
def create_field(portal_id):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal, need_admin=True)
    data = request.get_json(silent=True) or {}

    label = (data.get("label") or "").strip()
    field_type = data.get("field_type", FieldType.TEXT)

    if not label:
        return jsonify({"error": "label is required"}), 400
    if field_type not in FieldType.ALL:
        return jsonify({"error": f"field_type must be one of: {FieldType.ALL}"}), 400

    # Auto-generate field_key from label if not provided
    import re
    field_key = data.get("field_key") or re.sub(r"[^\w]", "_", label.lower()).strip("_")

    # Find the next order position
    max_order = db.session.query(db.func.max(PortalField.order)).filter_by(portal_id=portal_id).scalar() or -1

    pf = PortalField(
        portal_id=portal_id,
        label=label,
        field_key=field_key,
        field_type=field_type,
        placeholder=data.get("placeholder"),
        is_required=data.get("is_required", False),
        options=data.get("options"),
        order=data.get("order", max_order + 1),
    )
    db.session.add(pf)
    db.session.commit()
    return jsonify(_field_dict(pf)), 201


@api_bp.route("/portals/<int:portal_id>/fields/<int:field_id>", methods=["PUT"])
@require_admin
def update_field(portal_id, field_id):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal, need_admin=True)
    pf = PortalField.query.filter_by(id=field_id, portal_id=portal_id).first_or_404()
    data = request.get_json(silent=True) or {}

    for attr in ["label", "placeholder", "is_required", "options", "order", "field_type"]:
        if attr in data:
            setattr(pf, attr, data[attr])

    db.session.commit()
    return jsonify(_field_dict(pf))


@api_bp.route("/portals/<int:portal_id>/fields/<int:field_id>", methods=["DELETE"])
@require_admin
def delete_field(portal_id, field_id):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal, need_admin=True)
    pf = PortalField.query.filter_by(id=field_id, portal_id=portal_id).first_or_404()
    db.session.delete(pf)
    db.session.commit()
    return "", 204


@api_bp.route("/portals/<int:portal_id>/fields/reorder", methods=["POST"])
@require_admin
def reorder_fields(portal_id):
    """Accepts {"order": [field_id, field_id, ...]} and updates sort positions."""
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal, need_admin=True)
    data = request.get_json(silent=True) or {}
    order_ids = data.get("order", [])

    fields = {f.id: f for f in portal.fields.all()}
    for idx, fid in enumerate(order_ids):
        if fid in fields:
            fields[fid].order = idx

    db.session.commit()
    return jsonify({"ok": True})


# ── Helpers ──────────────────────────────────────────────────────────────────


def _tenant_role(user, tenant_id: int) -> str | None:
    """Effective role for user in a specific tenant, or None if no access."""
    if user.is_superadmin:
        return "superadmin"
    if user.tenant_id == tenant_id:
        return user.role
    from app.models import UserTenantMembership
    m = UserTenantMembership.query.filter_by(user_id=user.id, tenant_id=tenant_id).first()
    return m.role if m else None


def _assert_portal_access(portal: Portal, need_admin: bool = False):
    from flask import abort
    user = get_current_user()
    role = _tenant_role(user, portal.site.tenant_id)
    if role is None:
        abort(403)
    if need_admin and role not in ("superadmin", "admin"):
        abort(403)


def _assert_site_access(site: UnifiSite, need_admin: bool = False):
    from flask import abort
    user = get_current_user()
    role = _tenant_role(user, site.tenant_id)
    if role is None:
        abort(403)
    if need_admin and role not in ("superadmin", "admin"):
        abort(403)


def _portal_dict(p: Portal, include_fields=False) -> dict:
    d = {
        "id": p.id,
        "name": p.name,
        "slug": p.slug,
        "site_id": p.site_id,
        "site_name": p.site.name if p.site else None,
        "ssids": p.ssids or [],
        "auth_type": p.auth_type,
        "is_active": p.is_active,
        "logo_path": p.logo_path,
        "background_image_path": p.background_image_path,
        "primary_color": p.primary_color,
        "secondary_color": p.secondary_color,
        "font_family": p.font_family,
        "layout": p.layout,
        "card_opacity": p.card_opacity,
        "welcome_heading": p.welcome_heading,
        "welcome_text": p.welcome_text,
        "disclaimer": p.disclaimer,
        "button_label": p.button_label,
        "require_terms_acceptance": p.require_terms_acceptance,
        "terms_checkbox_label": p.terms_checkbox_label,
        "terms_url": p.terms_url,
        "social_facebook": p.social_facebook,
        "social_instagram": p.social_instagram,
        "social_twitter_x": p.social_twitter_x,
        "social_tiktok": p.social_tiktok,
        "post_connect_heading": p.post_connect_heading,
        "post_connect_text": p.post_connect_text,
        "promo_banner_path": p.promo_banner_path,
        "promo_banner_link": p.promo_banner_link,
        "redirect_url": p.redirect_url,
        "connect_delay_seconds": p.connect_delay_seconds,
        "session_duration": p.session_duration,
        "rate_limit_down": p.rate_limit_down,
        "rate_limit_up": p.rate_limit_up,
        "data_retention_days": p.data_retention_days,
        "maintenance_mode": p.maintenance_mode,
        "created_at": p.created_at.isoformat(),
        "updated_at": p.updated_at.isoformat(),
        "portal_url": f"/p/{p.slug}",
        "dispatch_url": "/portal",
    }
    if include_fields:
        d["fields"] = [_field_dict(f) for f in p.fields.order_by(PortalField.order)]
    return d


def _field_dict(f: PortalField) -> dict:
    return {
        "id": f.id,
        "portal_id": f.portal_id,
        "label": f.label,
        "field_key": f.field_key,
        "field_type": f.field_type,
        "placeholder": f.placeholder,
        "is_required": f.is_required,
        "options": f.options,
        "order": f.order,
    }
