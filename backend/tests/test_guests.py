import csv
import io
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.services.unifi import UnifiError
from tests.factories import make_tenant_stack, make_guest_session


def test_list_guests_search_by_mac(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    make_guest_session(portal, mac_address="AA:BB:CC:00:00:01")
    make_guest_session(portal, mac_address="11:22:33:00:00:02")

    resp = client.get(
        f"/api/portals/{portal.id}/guests?search=AA:BB:CC", headers=auth_headers(admin)
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["total"] == 1
    assert body["items"][0]["mac_address"] == "AA:BB:CC:00:00:01"


def test_list_guests_filters_by_ssid(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    make_guest_session(portal, mac_address="AA:BB:CC:00:00:01", ssid="Guest-WiFi")
    make_guest_session(portal, mac_address="AA:BB:CC:00:00:02", ssid="Other-WiFi")

    resp = client.get(
        f"/api/portals/{portal.id}/guests?ssid=Guest-WiFi", headers=auth_headers(admin)
    )
    body = resp.get_json()
    assert body["total"] == 1
    assert body["items"][0]["ssid"] == "Guest-WiFi"


def test_list_guests_filters_by_date_range(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    old = make_guest_session(
        portal, mac_address="AA:BB:CC:00:00:01",
        authorized_at=datetime.now(timezone.utc) - timedelta(days=10),
    )
    recent = make_guest_session(portal, mac_address="AA:BB:CC:00:00:02")

    date_from = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
    resp = client.get(
        f"/api/portals/{portal.id}/guests?date_from={date_from}", headers=auth_headers(admin)
    )
    body = resp.get_json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == recent.id


def test_list_guests_pagination(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    for i in range(5):
        make_guest_session(portal, mac_address=f"AA:BB:CC:00:00:0{i}")

    resp = client.get(
        f"/api/portals/{portal.id}/guests?page=1&per_page=2", headers=auth_headers(admin)
    )
    body = resp.get_json()
    assert body["total"] == 5
    assert body["pages"] == 3
    assert len(body["items"]) == 2


def test_guests_summary_return_visitor_rate(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    make_guest_session(portal, mac_address="AA:BB:CC:00:00:01")
    make_guest_session(portal, mac_address="AA:BB:CC:00:00:01")  # returning
    make_guest_session(portal, mac_address="AA:BB:CC:00:00:02")  # single visit

    resp = client.get(f"/api/portals/{portal.id}/guests/summary", headers=auth_headers(admin))
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["total_sessions"] == 3
    assert body["unique_devices"] == 2
    assert body["return_visitor_rate"] == 50.0


def test_guests_summary_auth_failures(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    make_guest_session(portal, mac_address="AA:BB:CC:00:00:01", auth_success=True)
    make_guest_session(
        portal, mac_address="AA:BB:CC:00:00:02", auth_success=False, auth_error="Timeout"
    )

    resp = client.get(f"/api/portals/{portal.id}/guests/summary", headers=auth_headers(admin))
    body = resp.get_json()
    assert body["auth_failures"]["count"] == 1
    assert body["auth_failures"]["top_errors"][0]["error"] == "Timeout"


def test_export_guests_csv(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    make_guest_session(portal, mac_address="AA:BB:CC:00:00:01", ip_address="10.0.0.5")

    resp = client.get(f"/api/portals/{portal.id}/guests/export", headers=auth_headers(admin))
    assert resp.status_code == 200
    assert resp.mimetype == "text/csv"
    rows = list(csv.reader(io.StringIO(resp.get_data(as_text=True))))
    assert rows[0][:4] == ["Date", "MAC Address", "IP Address", "SSID"]
    assert rows[1][1] == "AA:BB:CC:00:00:01"
    assert rows[1][2] == "10.0.0.5"


def test_reconnect_guest_success(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    session = make_guest_session(portal)

    with patch("app.api.guests.UnifiClient") as mock_client_cls:
        mock_client_cls.return_value.authorize_guest.return_value = {}
        resp = client.post(f"/api/guests/{session.id}/reconnect", headers=auth_headers(admin))

    assert resp.status_code == 200
    assert resp.get_json()["ok"] is True


def test_reconnect_guest_unifi_error_returns_502(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    session = make_guest_session(portal)

    with patch("app.api.guests.UnifiClient") as mock_client_cls:
        mock_client_cls.return_value.authorize_guest.side_effect = UnifiError("controller down")
        resp = client.post(f"/api/guests/{session.id}/reconnect", headers=auth_headers(admin))

    assert resp.status_code == 502
    assert "controller down" in resp.get_json()["error"]


def test_unauthorize_guest_success(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    session = make_guest_session(portal)

    with patch("app.api.guests.UnifiClient") as mock_client_cls:
        mock_client_cls.return_value.unauthorize_guest.return_value = {}
        resp = client.post(f"/api/guests/{session.id}/unauthorize", headers=auth_headers(admin))

    assert resp.status_code == 200
    assert resp.get_json()["ok"] is True


def test_active_devices_uses_unifi_client(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()

    with patch("app.api.guests.UnifiClient") as mock_client_cls:
        mock_client_cls.return_value.get_active_clients.return_value = [
            {"mac": "AA:BB:CC:00:00:01", "hostname": "phone", "ip": "10.0.0.9", "essid": "Guest-WiFi"}
        ]
        resp = client.get(f"/api/portals/{portal.id}/active_devices", headers=auth_headers(admin))

    assert resp.status_code == 200
    devices = resp.get_json()["devices"]
    assert len(devices) == 1
    assert devices[0]["mac"] == "aa:bb:cc:00:00:01"


def test_authorize_device_success_creates_guest_session(client, db_session, auth_headers):
    from app.models import GuestSession

    tenant, admin, controller, site, portal = make_tenant_stack()
    mac = "AA:BB:CC:00:00:09"

    with patch("app.api.guests.UnifiClient") as mock_client_cls:
        mock_client_cls.return_value.get_active_clients.return_value = [
            {"mac": mac, "hostname": "stuck-phone", "ip": "10.0.0.42", "essid": "Guest-WiFi", "ap_mac": "11:22:33:44:55:66"}
        ]
        mock_client_cls.return_value.authorize_guest.return_value = {}
        resp = client.post(
            f"/api/portals/{portal.id}/devices/{mac}/authorize", headers=auth_headers(admin)
        )

    assert resp.status_code == 200
    assert resp.get_json()["ok"] is True

    session = GuestSession.query.filter_by(portal_id=portal.id, mac_address=mac.lower()).one()
    assert session.auth_success is True
    assert session.auth_error is None
    assert session.hostname == "stuck-phone"
    assert session.ip_address == "10.0.0.42"
    assert session.ssid == "Guest-WiFi"
    assert session.voucher_id is None
    assert session.form_data == {}

    # Platform default duration (60) used since the portal has no override.
    call_kwargs = mock_client_cls.return_value.authorize_guest.call_args.kwargs
    assert call_kwargs["minutes"] == 60
    assert call_kwargs["mac"] == mac.lower()


def test_authorize_device_prefers_portal_overrides(client, db_session, auth_headers):
    tenant, admin, controller, site, portal = make_tenant_stack()
    portal.session_duration = 120
    portal.rate_limit_down = 5000
    portal.rate_limit_up = 1000
    db_session.commit()
    mac = "AA:BB:CC:00:00:10"

    with patch("app.api.guests.UnifiClient") as mock_client_cls:
        mock_client_cls.return_value.get_active_clients.return_value = []
        mock_client_cls.return_value.authorize_guest.return_value = {}
        resp = client.post(
            f"/api/portals/{portal.id}/devices/{mac}/authorize", headers=auth_headers(admin)
        )

    assert resp.status_code == 200
    call_kwargs = mock_client_cls.return_value.authorize_guest.call_args.kwargs
    assert call_kwargs["minutes"] == 120
    assert call_kwargs["down_kbps"] == 5000
    assert call_kwargs["up_kbps"] == 1000


def test_authorize_device_unifi_error_still_records_session(client, db_session, auth_headers):
    from app.models import GuestSession

    tenant, admin, controller, site, portal = make_tenant_stack()
    mac = "AA:BB:CC:00:00:11"

    with patch("app.api.guests.UnifiClient") as mock_client_cls:
        mock_client_cls.return_value.get_active_clients.return_value = []
        mock_client_cls.return_value.authorize_guest.side_effect = UnifiError("controller down")
        resp = client.post(
            f"/api/portals/{portal.id}/devices/{mac}/authorize", headers=auth_headers(admin)
        )

    assert resp.status_code == 502
    assert "controller down" in resp.get_json()["error"]

    session = GuestSession.query.filter_by(portal_id=portal.id, mac_address=mac.lower()).one()
    assert session.auth_success is False
    assert session.auth_error == "controller down"
