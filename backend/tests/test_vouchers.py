from datetime import datetime, timedelta, timezone

from tests.factories import make_tenant_stack, make_voucher


def test_create_single_voucher(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    resp = client.post(
        f"/api/portals/{portal.id}/vouchers",
        json={"count": 1, "duration_minutes": 30, "usage_limit": 2},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 201
    body = resp.get_json()
    assert len(body) == 1
    assert body[0]["duration_minutes"] == 30
    assert body[0]["usage_limit"] == 2
    assert body[0]["is_active"] is True


def test_create_batch_vouchers_unique_codes(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    resp = client.post(
        f"/api/portals/{portal.id}/vouchers", json={"count": 25}, headers=auth_headers(admin)
    )
    assert resp.status_code == 201
    body = resp.get_json()
    assert len(body) == 25
    codes = {v["code"] for v in body}
    assert len(codes) == 25  # all unique, satisfying the (portal_id, code) constraint


def test_create_vouchers_count_clamped_to_500(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    resp = client.post(
        f"/api/portals/{portal.id}/vouchers", json={"count": 10000}, headers=auth_headers(admin)
    )
    assert resp.status_code == 201
    assert len(resp.get_json()) == 500


def test_list_vouchers_active_only_filter(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    active = make_voucher(portal)
    inactive = make_voucher(portal, is_active=False)

    resp_all = client.get(f"/api/portals/{portal.id}/vouchers", headers=auth_headers(admin))
    assert len(resp_all.get_json()) == 2

    resp_active = client.get(
        f"/api/portals/{portal.id}/vouchers?active_only=true", headers=auth_headers(admin)
    )
    body = resp_active.get_json()
    assert len(body) == 1
    assert body[0]["id"] == active.id


def test_get_voucher(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    voucher = make_voucher(portal)

    resp = client.get(f"/api/vouchers/{voucher.id}", headers=auth_headers(admin))
    assert resp.status_code == 200
    assert resp.get_json()["code"] == voucher.code


def test_revoke_voucher_soft_deletes(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    voucher = make_voucher(portal)

    resp = client.delete(f"/api/vouchers/{voucher.id}", headers=auth_headers(admin))
    assert resp.status_code == 200
    assert resp.get_json()["is_active"] is False

    still_there = client.get(f"/api/vouchers/{voucher.id}", headers=auth_headers(admin))
    assert still_there.status_code == 200


def test_voucher_is_valid_when_active_and_unused():
    from app.models import Voucher
    v = Voucher(usage_limit=1, usage_count=0, is_active=True)
    assert v.is_valid is True


def test_voucher_is_valid_false_when_inactive():
    from app.models import Voucher
    v = Voucher(usage_limit=1, usage_count=0, is_active=False)
    assert v.is_valid is False


def test_voucher_is_valid_false_when_usage_exhausted():
    from app.models import Voucher
    v = Voucher(usage_limit=1, usage_count=1, is_active=True)
    assert v.is_valid is False


def test_voucher_is_valid_unlimited_usage():
    from app.models import Voucher
    v = Voucher(usage_limit=0, usage_count=1000, is_active=True)
    assert v.is_valid is True


def test_voucher_is_valid_false_when_expired():
    from app.models import Voucher
    v = Voucher(
        usage_limit=1, usage_count=0, is_active=True,
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    assert v.is_valid is False


def test_voucher_is_valid_true_when_not_yet_expired():
    from app.models import Voucher
    v = Voucher(
        usage_limit=1, usage_count=0, is_active=True,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=1),
    )
    assert v.is_valid is True
