from flask import request, jsonify
from app.extensions import db
from app.models import AuditLog, UserTenantMembership
from . import api_bp
from .decorators import require_admin, get_current_user


@api_bp.route("/audit-log", methods=["GET"])
@require_admin
def list_audit_log():
    user = get_current_user()
    page = int(request.args.get("page", 1))
    per_page = min(int(request.args.get("per_page", 50)), 200)
    action_filter = request.args.get("action", "").strip()

    q = AuditLog.query.order_by(AuditLog.created_at.desc())

    if not user.is_superadmin:
        from app.models import UserRole
        admin_memberships = UserTenantMembership.query.filter_by(user_id=user.id, role="admin").all()
        tenant_ids_set = {m.tenant_id for m in admin_memberships}
        if user.role == UserRole.ADMIN and user.tenant_id:
            tenant_ids_set.add(user.tenant_id)
        tenant_ids = list(tenant_ids_set)
        q = q.filter(AuditLog.tenant_id.in_(tenant_ids))

    if action_filter:
        q = q.filter(AuditLog.action.ilike(f"%{action_filter}%"))

    paginated = q.paginate(page=page, per_page=per_page, error_out=False)
    return jsonify({
        "items": [_log_dict(l) for l in paginated.items],
        "total": paginated.total,
        "page": page,
        "pages": paginated.pages,
        "per_page": per_page,
    })


def _log_dict(l: AuditLog) -> dict:
    return {
        "id": l.id,
        "user_email": l.user_email,
        "tenant_id": l.tenant_id,
        "action": l.action,
        "resource_type": l.resource_type,
        "resource_id": l.resource_id,
        "detail": l.detail,
        "ip_address": l.ip_address,
        "created_at": l.created_at.isoformat(),
    }
