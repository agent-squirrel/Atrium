from datetime import datetime, timezone, timedelta
from flask import jsonify
from app.extensions import db
from app.models import Portal, UnifiSite, UnifiController, GuestSession, UserTenantMembership
from . import api_bp
from .decorators import require_auth, get_current_user


@api_bp.route("/dashboard/stats", methods=["GET"])
@require_auth
def dashboard_stats():
    user = get_current_user()
    from app.api.settings import get_setting

    default_duration = int(get_setting("default_session_duration") or "60")
    now = datetime.now(timezone.utc)

    # Portals accessible to this user (mirrors list_portals logic)
    q = Portal.query.join(UnifiSite)
    if not user.is_superadmin:
        extra = [m.tenant_id for m in UserTenantMembership.query.filter_by(user_id=user.id)]
        tenant_ids = list({user.tenant_id, *extra} - {None})
        q = q.filter(UnifiSite.tenant_id.in_(tenant_ids))
    portals = q.all()

    portals_total = len(portals)
    portals_active = sum(1 for p in portals if p.is_active)

    # Count guest sessions still within their session window
    active_guests = 0
    for portal in portals:
        duration = portal.session_duration or default_duration
        cutoff = now - timedelta(minutes=duration)
        active_guests += GuestSession.query.filter(
            GuestSession.portal_id == portal.id,
            GuestSession.auth_success.is_(True),
            GuestSession.authorized_at >= cutoff,
        ).count()

    result: dict = {
        "portals_total": portals_total,
        "portals_active": portals_active,
        "active_guests": active_guests,
    }

    if user.is_superadmin:
        from app.models import Tenant
        result["controllers"] = UnifiController.query.filter_by(is_active=True).count()
        result["tenants"] = Tenant.query.filter_by(is_active=True).count()

    return jsonify(result)
