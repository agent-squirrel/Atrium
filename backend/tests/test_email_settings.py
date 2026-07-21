from unittest.mock import patch

from app.extensions import db
from app.models import UserRole, EmailSettings
from tests.factories import make_user


def _reset_email_settings() -> None:
    """Delete any existing EmailSettings row so a test starts from defaults.
    Needed because this singleton row can leak across tests under the current
    db_session fixture's isolation gap, the same way session_remember_days
    does in test_auth.py."""
    existing = db.session.get(EmailSettings, 1)
    if existing:
        db.session.delete(existing)
        db.session.commit()


def test_get_email_settings_requires_superadmin(client, db_session, auth_headers):
    user = make_user(role=UserRole.ADMIN)
    resp = client.get("/api/settings/email", headers=auth_headers(user))
    assert resp.status_code == 403


def test_get_email_settings_defaults(client, db_session, auth_headers):
    _reset_email_settings()
    admin = make_user(role=UserRole.SUPERADMIN)
    resp = client.get("/api/settings/email", headers=auth_headers(admin))
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["enabled"] is False
    assert body["has_password"] is False
    assert body["encryption"] == "starttls"


def test_update_email_settings(client, db_session, auth_headers):
    _reset_email_settings()
    admin = make_user(role=UserRole.SUPERADMIN)
    resp = client.put(
        "/api/settings/email",
        json={
            "enabled": True,
            "smtp_host": "smtp.example.com",
            "smtp_port": 587,
            "smtp_username": "apikey",
            "password": "super-secret",
            "from_address": "noreply@example.com",
            "from_name": "Atrium",
            "encryption": "starttls",
        },
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["smtp_host"] == "smtp.example.com"
    assert body["has_password"] is True
    assert "password" not in body


def test_update_email_settings_blank_password_leaves_existing_credential(client, db_session, auth_headers):
    _reset_email_settings()
    admin = make_user(role=UserRole.SUPERADMIN)
    client.put("/api/settings/email", json={"password": "first-secret"}, headers=auth_headers(admin))

    stored_before = EmailSettings.get_or_create()._smtp_password_encrypted

    resp = client.put("/api/settings/email", json={"smtp_host": "smtp2.example.com", "password": ""}, headers=auth_headers(admin))
    assert resp.status_code == 200

    stored_after = EmailSettings.get_or_create()._smtp_password_encrypted
    assert stored_after == stored_before


def test_update_email_settings_rejects_invalid_encryption(client, db_session, auth_headers):
    admin = make_user(role=UserRole.SUPERADMIN)
    resp = client.put("/api/settings/email", json={"encryption": "carrier-pigeon"}, headers=auth_headers(admin))
    assert resp.status_code == 400


def test_send_test_email_not_configured(client, db_session, auth_headers):
    _reset_email_settings()
    admin = make_user(role=UserRole.SUPERADMIN)
    resp = client.post("/api/settings/email/test", json={}, headers=auth_headers(admin))
    assert resp.status_code == 400
    assert resp.get_json()["ok"] is False


def test_send_test_email_success(client, db_session, auth_headers):
    _reset_email_settings()
    admin = make_user(role=UserRole.SUPERADMIN)
    client.put(
        "/api/settings/email",
        json={"enabled": True, "smtp_host": "smtp.example.com", "from_address": "noreply@example.com"},
        headers=auth_headers(admin),
    )
    with patch("app.mailer.smtplib.SMTP") as mock_smtp:
        resp = client.post("/api/settings/email/test", json={"to": "someone@example.com"}, headers=auth_headers(admin))
    assert resp.status_code == 200
    assert resp.get_json()["ok"] is True
    mock_smtp.assert_called_once()
