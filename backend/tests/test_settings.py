from app.extensions import db
from app.models import UserRole, PlatformSetting
from tests.factories import make_user


def _reset_display_settings() -> None:
    """Delete any existing timezone/date_format PlatformSetting rows so a
    test starts from the default. Needed because these rows can leak across
    tests under the current db_session fixture's isolation gap - same
    pattern as session_remember_days / email_settings elsewhere in this
    suite."""
    for key in ("timezone", "date_format"):
        existing = db.session.get(PlatformSetting, key)
        if existing:
            db.session.delete(existing)
    db.session.commit()


def test_update_settings_rejects_invalid_timezone(client, db_session, auth_headers):
    _reset_display_settings()
    admin = make_user(role=UserRole.SUPERADMIN)
    resp = client.put(
        "/api/settings", json={"timezone": "Not/AZone"}, headers=auth_headers(admin)
    )
    assert resp.status_code == 400
    assert "timezone" in resp.get_json()["error"].lower()


def test_update_settings_accepts_valid_timezone(client, db_session, auth_headers):
    _reset_display_settings()
    admin = make_user(role=UserRole.SUPERADMIN)
    resp = client.put(
        "/api/settings", json={"timezone": "Australia/Sydney"}, headers=auth_headers(admin)
    )
    assert resp.status_code == 200
    assert resp.get_json()["timezone"]["value"] == "Australia/Sydney"


def test_update_settings_rejects_invalid_date_format(client, db_session, auth_headers):
    _reset_display_settings()
    admin = make_user(role=UserRole.SUPERADMIN)
    resp = client.put(
        "/api/settings", json={"date_format": "DD-MM-YY"}, headers=auth_headers(admin)
    )
    assert resp.status_code == 400
    assert "date format" in resp.get_json()["error"].lower()


def test_update_settings_accepts_valid_date_format(client, db_session, auth_headers):
    _reset_display_settings()
    admin = make_user(role=UserRole.SUPERADMIN)
    resp = client.put(
        "/api/settings", json={"date_format": "DD/MM/YYYY"}, headers=auth_headers(admin)
    )
    assert resp.status_code == 200
    assert resp.get_json()["date_format"]["value"] == "DD/MM/YYYY"


def test_get_display_settings_defaults(client, db_session, auth_headers):
    _reset_display_settings()
    user = make_user(role=UserRole.CLIENT)
    resp = client.get("/api/settings/display", headers=auth_headers(user))
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["timezone"] == "UTC"
    assert body["date_format"] == "MM/DD/YYYY"


def test_get_display_settings_reachable_by_non_superadmin(client, db_session, auth_headers):
    _reset_display_settings()
    admin = make_user(role=UserRole.SUPERADMIN)
    client.put(
        "/api/settings",
        json={"timezone": "America/New_York", "date_format": "YYYY-MM-DD"},
        headers=auth_headers(admin),
    )

    client_user = make_user(role=UserRole.CLIENT)
    resp = client.get("/api/settings/display", headers=auth_headers(client_user))
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["timezone"] == "America/New_York"
    assert body["date_format"] == "YYYY-MM-DD"


def test_get_display_settings_requires_auth(client, db_session):
    resp = client.get("/api/settings/display")
    assert resp.status_code == 401
