"""Thin helper for writing audit log entries.

Always call record() AFTER the main db.session.commit() so that the
audit entry and the operation it describes don't share a transaction.
"""
from .extensions import db
from .models.audit_log import AuditLog


def record(action: str, *, user=None, user_email: str | None = None,
           tenant_id: int | None = None,
           resource_type: str | None = None, resource_id: int | None = None,
           detail: dict | None = None) -> None:
    from flask import request

    uid = None
    email = user_email

    if user is not None:
        uid = user.id
        email = email or user.email
    else:
        try:
            from flask_jwt_extended import get_jwt_identity
            identity = get_jwt_identity()
            if identity:
                from .models import User
                u = db.session.get(User, int(identity))
                if u:
                    uid = u.id
                    email = email or u.email
        except Exception:
            pass

    ip = (request.headers.get("X-Real-IP") or request.remote_addr or "")[:50]

    # Auto-derive tenant_id from the acting user if not given explicitly
    tid = tenant_id
    if tid is None and uid:
        try:
            from .models import User
            u = db.session.get(User, uid)
            if u:
                tid = u.tenant_id
        except Exception:
            pass

    log = AuditLog(
        user_id=uid,
        user_email=email,
        tenant_id=tid,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        detail=detail,
        ip_address=ip,
    )
    db.session.add(log)
    db.session.commit()
