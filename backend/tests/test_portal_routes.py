from unittest.mock import patch
from urllib.parse import urlparse, parse_qs

from app.extensions import db
from app.models import AuthType, GuestSession, PortalField
from app.services.unifi import UnifiError
from tests.factories import make_tenant_stack, make_voucher


def _token_from_redirect(resp):
    location = resp.headers["Location"]
    qs = parse_qs(urlparse(location).query)
    return qs["token"][0]


def _connect(client, portal, **form_overrides):
    form = {
        "mac": "AA:BB:CC:DD:EE:FF",
        "ap_mac": "11:22:33:44:55:66",
        "ssid": "Guest-WiFi",
        "redirect_url": "",
        "t": "123",
    }
    form.update(form_overrides)
    return client.post(f"/p/{portal.slug}/connect", data=form)


# ── show_portal ──────────────────────────────────────────────────────────────

def test_show_portal_renders_form(client, db_session):
    tenant, admin, controller, site, portal = make_tenant_stack()
    portal.auth_type = AuthType.CLICK_THROUGH
    db.session.commit()

    resp = client.get(f"/p/{portal.slug}")
    assert resp.status_code == 200
    assert b"connect" in resp.data.lower()


def test_show_portal_404_for_inactive(client, db_session):
    tenant, admin, controller, site, portal = make_tenant_stack()
    portal.is_active = False
    db.session.commit()

    resp = client.get(f"/p/{portal.slug}")
    assert resp.status_code == 404


def test_show_portal_maintenance_mode_returns_503(client, db_session):
    tenant, admin, controller, site, portal = make_tenant_stack()
    portal.maintenance_mode = True
    db.session.commit()

    resp = client.get(f"/p/{portal.slug}")
    assert resp.status_code == 503


# ── connect: validation ──────────────────────────────────────────────────────

def test_connect_missing_required_field_returns_422(client, db_session):
    tenant, admin, controller, site, portal = make_tenant_stack()
    portal.auth_type = AuthType.CLICK_THROUGH
    field = PortalField(portal=portal, label="Full Name", field_key="full_name", is_required=True)
    db.session.add(field)
    db.session.commit()

    resp = _connect(client, portal)
    assert resp.status_code == 422
    assert b"Full Name is required" in resp.data


def test_connect_requires_terms_acceptance(client, db_session):
    tenant, admin, controller, site, portal = make_tenant_stack()
    portal.auth_type = AuthType.CLICK_THROUGH
    portal.require_terms_acceptance = True
    db.session.commit()

    resp = _connect(client, portal)
    assert resp.status_code == 422
    assert b"Terms" in resp.data


def test_connect_terms_accepted_proceeds(client, db_session):
    tenant, admin, controller, site, portal = make_tenant_stack()
    portal.auth_type = AuthType.CLICK_THROUGH
    portal.require_terms_acceptance = True
    db.session.commit()

    resp = _connect(client, portal, terms_accepted="true")
    assert resp.status_code == 302


def test_connect_voucher_required_when_missing(client, db_session):
    tenant, admin, controller, site, portal = make_tenant_stack()
    portal.auth_type = AuthType.VOUCHER
    db.session.commit()

    resp = _connect(client, portal)
    assert resp.status_code == 422
    assert b"voucher code is required" in resp.data


def test_connect_voucher_invalid_code(client, db_session):
    tenant, admin, controller, site, portal = make_tenant_stack()
    portal.auth_type = AuthType.VOUCHER
    db.session.commit()

    resp = _connect(client, portal, voucher_code="NOTREAL")
    assert resp.status_code == 422
    assert b"Invalid or expired voucher" in resp.data


# ── connect: deferred authorization ──────────────────────────────────────────

def test_connect_defers_authorization(client, db_session):
    """The core guarantee: submitting the form must NOT authorize the device
    or create a GuestSession yet - that only happens in finalize()."""
    tenant, admin, controller, site, portal = make_tenant_stack()
    portal.auth_type = AuthType.CLICK_THROUGH
    db.session.commit()

    with patch("app.portal.routes.UnifiClient") as mock_client_cls:
        resp = _connect(client, portal)
        mock_client_cls.return_value.authorize_guest.assert_not_called()

    assert resp.status_code == 302
    assert "/success" in resp.headers["Location"]
    assert GuestSession.query.filter_by(portal_id=portal.id).count() == 0


# ── success ──────────────────────────────────────────────────────────────────

def test_success_without_token_redirects_to_form(client, db_session):
    tenant, admin, controller, site, portal = make_tenant_stack()

    resp = client.get(f"/p/{portal.slug}/success")
    assert resp.status_code == 302
    assert resp.headers["Location"].rstrip("/").endswith(portal.slug)


def test_success_with_token_renders_countdown(client, db_session):
    tenant, admin, controller, site, portal = make_tenant_stack()
    portal.auth_type = AuthType.CLICK_THROUGH
    portal.connect_delay_seconds = 7
    db.session.commit()

    with patch("app.portal.routes.UnifiClient"):
        connect_resp = _connect(client, portal)
    token = _token_from_redirect(connect_resp)

    resp = client.get(f"/p/{portal.slug}/success?token={token}")
    assert resp.status_code == 200
    assert b"7</span> seconds" in resp.data


# ── finalize ─────────────────────────────────────────────────────────────────

def test_finalize_authorizes_and_creates_session(client, db_session):
    tenant, admin, controller, site, portal = make_tenant_stack()
    portal.auth_type = AuthType.CLICK_THROUGH
    db.session.commit()

    with patch("app.portal.routes.UnifiClient") as mock_client_cls:
        mock_client_cls.return_value.authorize_guest.return_value = {}
        connect_resp = _connect(client, portal)
        token = _token_from_redirect(connect_resp)

        resp = client.post(f"/p/{portal.slug}/finalize", data={"token": token})

        assert resp.status_code == 200
        assert resp.get_json()["ok"] is True
        mock_client_cls.return_value.authorize_guest.assert_called_once()

    session = GuestSession.query.filter_by(portal_id=portal.id).one()
    assert session.mac_address == "AA:BB:CC:DD:EE:FF"
    assert session.auth_success is True


def test_finalize_unifi_error_returns_503(client, db_session):
    tenant, admin, controller, site, portal = make_tenant_stack()
    portal.auth_type = AuthType.CLICK_THROUGH
    db.session.commit()

    with patch("app.portal.routes.UnifiClient") as mock_client_cls:
        mock_client_cls.return_value.authorize_guest.side_effect = UnifiError("controller down")
        connect_resp = _connect(client, portal)
        token = _token_from_redirect(connect_resp)

        resp = client.post(f"/p/{portal.slug}/finalize", data={"token": token})

    assert resp.status_code == 503
    assert resp.get_json()["ok"] is False
    session = GuestSession.query.filter_by(portal_id=portal.id).one()
    assert session.auth_success is False
    assert "controller down" in session.auth_error


def test_finalize_invalid_token_returns_400(client, db_session):
    tenant, admin, controller, site, portal = make_tenant_stack()

    resp = client.post(f"/p/{portal.slug}/finalize", data={"token": "garbage.not.a.token"})
    assert resp.status_code == 400
    assert resp.get_json()["ok"] is False


def test_finalize_missing_token_returns_400(client, db_session):
    tenant, admin, controller, site, portal = make_tenant_stack()

    resp = client.post(f"/p/{portal.slug}/finalize", data={})
    assert resp.status_code == 400


def test_finalize_rejects_token_from_a_different_portal(client, db_session):
    tenant1, admin1, controller1, site1, portal1 = make_tenant_stack()
    tenant2, admin2, controller2, site2, portal2 = make_tenant_stack()
    portal1.auth_type = AuthType.CLICK_THROUGH
    portal2.auth_type = AuthType.CLICK_THROUGH
    db.session.commit()

    with patch("app.portal.routes.UnifiClient"):
        connect_resp = _connect(client, portal1)
    token = _token_from_redirect(connect_resp)

    resp = client.post(f"/p/{portal2.slug}/finalize", data={"token": token})
    assert resp.status_code == 400
    assert GuestSession.query.filter(
        GuestSession.portal_id.in_([portal1.id, portal2.id])
    ).count() == 0


def test_finalize_is_idempotent_on_retry(client, db_session):
    """A retried/duplicate finalize call for the same token must not
    re-authorize or create a second GuestSession."""
    tenant, admin, controller, site, portal = make_tenant_stack()
    portal.auth_type = AuthType.CLICK_THROUGH
    db.session.commit()

    with patch("app.portal.routes.UnifiClient") as mock_client_cls:
        mock_client_cls.return_value.authorize_guest.return_value = {}
        connect_resp = _connect(client, portal)
        token = _token_from_redirect(connect_resp)

        first = client.post(f"/p/{portal.slug}/finalize", data={"token": token})
        second = client.post(f"/p/{portal.slug}/finalize", data={"token": token})

        assert first.status_code == 200
        assert second.status_code == 200
        assert second.get_json()["ok"] is True
        mock_client_cls.return_value.authorize_guest.assert_called_once()

    assert GuestSession.query.filter_by(portal_id=portal.id).count() == 1


def test_finalize_increments_voucher_usage_exactly_once(client, db_session):
    tenant, admin, controller, site, portal = make_tenant_stack()
    portal.auth_type = AuthType.VOUCHER
    db.session.commit()
    voucher = make_voucher(portal, usage_limit=5, usage_count=0)

    with patch("app.portal.routes.UnifiClient") as mock_client_cls:
        mock_client_cls.return_value.authorize_guest.return_value = {}
        connect_resp = _connect(client, portal, voucher_code=voucher.code)
        token = _token_from_redirect(connect_resp)

        client.post(f"/p/{portal.slug}/finalize", data={"token": token})
        client.post(f"/p/{portal.slug}/finalize", data={"token": token})  # retry

    db.session.refresh(voucher)
    assert voucher.usage_count == 1
