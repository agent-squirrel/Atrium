from app.models import UserRole
from tests.factories import make_tenant_stack, make_user, make_voucher, make_guest_session


def _stacks():
    tenant_a, admin_a, _, _, portal_a = make_tenant_stack()
    tenant_b, admin_b, _, _, portal_b = make_tenant_stack()
    return tenant_a, admin_a, portal_a, tenant_b, admin_b, portal_b


def test_admin_cannot_list_other_tenants_vouchers(client, db_session, auth_headers):
    tenant_a, admin_a, portal_a, tenant_b, admin_b, portal_b = _stacks()
    make_voucher(portal_b)

    resp = client.get(f"/api/portals/{portal_b.id}/vouchers", headers=auth_headers(admin_a))
    assert resp.status_code == 403


def test_admin_can_list_own_tenants_vouchers(client, db_session, auth_headers):
    tenant_a, admin_a, portal_a, tenant_b, admin_b, portal_b = _stacks()
    make_voucher(portal_a)

    resp = client.get(f"/api/portals/{portal_a.id}/vouchers", headers=auth_headers(admin_a))
    assert resp.status_code == 200
    assert len(resp.get_json()) == 1


def test_admin_cannot_get_other_tenants_voucher(client, db_session, auth_headers):
    tenant_a, admin_a, portal_a, tenant_b, admin_b, portal_b = _stacks()
    voucher_b = make_voucher(portal_b)

    resp = client.get(f"/api/vouchers/{voucher_b.id}", headers=auth_headers(admin_a))
    assert resp.status_code == 403


def test_admin_cannot_create_voucher_for_other_tenant(client, db_session, auth_headers):
    tenant_a, admin_a, portal_a, tenant_b, admin_b, portal_b = _stacks()

    resp = client.post(
        f"/api/portals/{portal_b.id}/vouchers", json={"count": 1}, headers=auth_headers(admin_a)
    )
    assert resp.status_code == 403


def test_superadmin_can_access_any_tenants_vouchers(client, db_session, auth_headers):
    tenant_a, admin_a, portal_a, tenant_b, admin_b, portal_b = _stacks()
    make_voucher(portal_a)
    superadmin = make_user(role=UserRole.SUPERADMIN)

    resp_a = client.get(f"/api/portals/{portal_a.id}/vouchers", headers=auth_headers(superadmin))
    resp_b = client.get(f"/api/portals/{portal_b.id}/vouchers", headers=auth_headers(superadmin))
    assert resp_a.status_code == 200
    assert resp_b.status_code == 200


def test_admin_cannot_access_other_tenants_guest_session(client, db_session, auth_headers):
    tenant_a, admin_a, portal_a, tenant_b, admin_b, portal_b = _stacks()
    session_b = make_guest_session(portal_b)

    resp = client.get(f"/api/guests/{session_b.id}", headers=auth_headers(admin_a))
    assert resp.status_code == 403


def test_admin_cannot_list_other_tenants_guests(client, db_session, auth_headers):
    tenant_a, admin_a, portal_a, tenant_b, admin_b, portal_b = _stacks()
    make_guest_session(portal_b)

    resp = client.get(f"/api/portals/{portal_b.id}/guests", headers=auth_headers(admin_a))
    assert resp.status_code == 403


def test_admin_cannot_get_other_tenant_record(client, db_session, auth_headers):
    tenant_a, admin_a, portal_a, tenant_b, admin_b, portal_b = _stacks()

    resp = client.get(f"/api/tenants/{tenant_b.id}", headers=auth_headers(admin_a))
    assert resp.status_code == 403


def test_admin_can_get_own_tenant_record(client, db_session, auth_headers):
    tenant_a, admin_a, portal_a, tenant_b, admin_b, portal_b = _stacks()

    resp = client.get(f"/api/tenants/{tenant_a.id}", headers=auth_headers(admin_a))
    assert resp.status_code == 200
    assert resp.get_json()["id"] == tenant_a.id


def test_superadmin_can_get_any_tenant_record(client, db_session, auth_headers):
    tenant_a, admin_a, portal_a, tenant_b, admin_b, portal_b = _stacks()
    superadmin = make_user(role=UserRole.SUPERADMIN)

    resp = client.get(f"/api/tenants/{tenant_b.id}", headers=auth_headers(superadmin))
    assert resp.status_code == 200


def test_client_role_scoped_like_admin_for_own_tenant_voucher_list(client, db_session, auth_headers):
    tenant_a, admin_a, portal_a, tenant_b, admin_b, portal_b = _stacks()
    client_a = make_user(tenant=tenant_a, role=UserRole.CLIENT)
    make_voucher(portal_a)

    resp = client.get(f"/api/portals/{portal_a.id}/vouchers", headers=auth_headers(client_a))
    assert resp.status_code == 200

    resp_forbidden = client.get(
        f"/api/portals/{portal_b.id}/vouchers", headers=auth_headers(client_a)
    )
    assert resp_forbidden.status_code == 403
