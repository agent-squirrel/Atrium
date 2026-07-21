from flask import request, jsonify
from datetime import datetime, timezone
from app.extensions import db
from app.models import Voucher, Portal
from . import api_bp
from .decorators import require_auth, require_admin, get_current_user


@api_bp.route("/portals/<int:portal_id>/vouchers", methods=["GET"])
@require_auth
def list_vouchers(portal_id):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal)

    active_only = request.args.get("active_only", "false").lower() == "true"
    q = Voucher.query.filter_by(portal_id=portal_id)
    if active_only:
        q = q.filter_by(is_active=True)

    vouchers = q.order_by(Voucher.created_at.desc()).all()
    return jsonify([_voucher_dict(v) for v in vouchers])


@api_bp.route("/portals/<int:portal_id>/vouchers", methods=["POST"])
@require_admin
def create_vouchers(portal_id):
    """Create one or more vouchers. Pass count > 1 for batch generation."""
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal)
    user = get_current_user()
    data = request.get_json(silent=True) or {}

    count = min(int(data.get("count", 1)), 500)
    duration_minutes = int(data.get("duration_minutes", 60))
    usage_limit = int(data.get("usage_limit", 1))
    note = data.get("note")
    rate_limit_down = data.get("rate_limit_down")
    rate_limit_up = data.get("rate_limit_up")
    expires_at = None
    if data.get("expires_at"):
        try:
            expires_at = datetime.fromisoformat(data["expires_at"])
        except ValueError:
            return jsonify({"error": "Invalid expires_at format, use ISO 8601"}), 400

    created = []
    for _ in range(count):
        v = Voucher(
            portal_id=portal_id,
            duration_minutes=duration_minutes,
            usage_limit=usage_limit,
            rate_limit_down=rate_limit_down,
            rate_limit_up=rate_limit_up,
            expires_at=expires_at,
            note=note,
            created_by_id=user.id,
        )
        db.session.add(v)
        created.append(v)

    db.session.commit()
    return jsonify([_voucher_dict(v) for v in created]), 201


@api_bp.route("/vouchers/<int:voucher_id>", methods=["GET"])
@require_auth
def get_voucher(voucher_id):
    v = Voucher.query.get_or_404(voucher_id)
    _assert_portal_access(v.portal)
    return jsonify(_voucher_dict(v))


@api_bp.route("/vouchers/<int:voucher_id>", methods=["DELETE"])
@require_admin
def revoke_voucher(voucher_id):
    v = Voucher.query.get_or_404(voucher_id)
    _assert_portal_access(v.portal)
    v.is_active = False
    db.session.commit()
    return jsonify(_voucher_dict(v))


def purge_expired_vouchers() -> int:
    """Delete vouchers that are expired or revoked and were never redeemed.
    Redeemed vouchers (usage_count > 0) are always kept - guest sessions
    reference them for history, and the DB would refuse the delete anyway.
    Shared by the `purge-expired-vouchers` CLI command and the scheduler."""
    now = datetime.now(timezone.utc)
    n = Voucher.query.filter(
        Voucher.usage_count == 0,
        db.or_(
            Voucher.is_active.is_(False),
            db.and_(Voucher.expires_at.isnot(None), Voucher.expires_at < now),
        ),
    ).delete(synchronize_session=False)
    db.session.commit()
    return n


def _assert_portal_access(portal: Portal):
    user = get_current_user()
    if user.is_superadmin:
        return
    if portal.site.tenant_id != user.tenant_id:
        from flask import abort
        abort(403)


def _voucher_dict(v: Voucher) -> dict:
    return {
        "id": v.id,
        "portal_id": v.portal_id,
        "code": v.code,
        "usage_limit": v.usage_limit,
        "usage_count": v.usage_count,
        "duration_minutes": v.duration_minutes,
        "rate_limit_down": v.rate_limit_down,
        "rate_limit_up": v.rate_limit_up,
        "is_active": v.is_active,
        "is_valid": v.is_valid,
        "expires_at": v.expires_at.isoformat() if v.expires_at else None,
        "note": v.note,
        "created_at": v.created_at.isoformat(),
        "created_by_id": v.created_by_id,
    }
