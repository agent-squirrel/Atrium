from app.extensions import db
from app.models import PlatformSetting, User, UserRole


def _ensure_no_superadmin() -> None:
    """/setup/complete refuses to run if any superadmin exists, and leaked
    PlatformSetting rows would make the "leaves default" test flaky - both
    can leak in from other test files under the current db_session
    fixture's isolation gap (same pattern documented elsewhere in this
    suite), so clear them defensively before each test."""
    for u in User.query.filter_by(role=UserRole.SUPERADMIN).all():
        db.session.delete(u)
    for key in ("timezone", "date_format"):
        setting = db.session.get(PlatformSetting, key)
        if setting:
            db.session.delete(setting)
    db.session.commit()


def test_setup_complete_persists_supplied_timezone_and_date_format(client, db_session):
    _ensure_no_superadmin()
    resp = client.post("/api/setup/complete", json={
        "email": "admin@example.com",
        "password": "Passw0rd!!",
        "first_name": "Ada",
        "last_name": "Admin",
        "timezone": "Australia/Sydney",
        "date_format": "DD/MM/YYYY",
    })
    assert resp.status_code == 201

    tz = PlatformSetting.query.filter_by(key="timezone").one()
    assert tz.value == "Australia/Sydney"
    date_format = PlatformSetting.query.filter_by(key="date_format").one()
    assert date_format.value == "DD/MM/YYYY"


def test_setup_complete_rejects_invalid_timezone(client, db_session):
    _ensure_no_superadmin()
    resp = client.post("/api/setup/complete", json={
        "email": "admin@example.com",
        "password": "Passw0rd!!",
        "timezone": "Not/AZone",
    })
    assert resp.status_code == 400


def test_setup_complete_rejects_invalid_date_format(client, db_session):
    _ensure_no_superadmin()
    resp = client.post("/api/setup/complete", json={
        "email": "admin@example.com",
        "password": "Passw0rd!!",
        "date_format": "DD-MM-YY",
    })
    assert resp.status_code == 400


def test_setup_complete_without_display_prefs_leaves_defaults(client, db_session):
    _ensure_no_superadmin()
    resp = client.post("/api/setup/complete", json={
        "email": "admin@example.com",
        "password": "Passw0rd!!",
    })
    assert resp.status_code == 201
    assert PlatformSetting.query.filter_by(key="timezone").first() is None
    assert PlatformSetting.query.filter_by(key="date_format").first() is None
