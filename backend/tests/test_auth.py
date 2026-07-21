from datetime import datetime, timezone, timedelta

import pyotp
from flask_jwt_extended import decode_token

from app.extensions import db
from app.models import UserRole, PlatformSetting
from tests.factories import make_user


def _refresh_token_exp(resp_body) -> datetime:
    payload = decode_token(resp_body["refresh_token"])
    return datetime.fromtimestamp(payload["exp"], tz=timezone.utc)


def _set_remember_days(value: str | None) -> None:
    """Upsert (or delete, if value is None) the session_remember_days setting.
    Uses merge/explicit-delete rather than a bare add(), because this key can
    leak across tests under the current db_session fixture's isolation gap
    when a test mixes a direct commit with a route-internal one."""
    existing = db.session.get(PlatformSetting, "session_remember_days")
    if value is None:
        if existing:
            db.session.delete(existing)
    elif existing:
        existing.value = value
    else:
        db.session.add(PlatformSetting(key="session_remember_days", value=value))
    db.session.commit()


def test_login_success(client, db_session):
    user = make_user(role=UserRole.ADMIN, password="Passw0rd!")
    resp = client.post("/api/auth/login", json={"email": user.email, "password": "Passw0rd!"})
    assert resp.status_code == 200
    body = resp.get_json()
    assert "access_token" in body
    assert "refresh_token" in body
    assert body["user"]["email"] == user.email


def test_login_wrong_password(client, db_session):
    user = make_user(password="Passw0rd!")
    resp = client.post("/api/auth/login", json={"email": user.email, "password": "wrong"})
    assert resp.status_code == 401


def test_login_unknown_email(client, db_session):
    resp = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "x"})
    assert resp.status_code == 401


def test_login_missing_fields(client, db_session):
    resp = client.post("/api/auth/login", json={"email": "a@example.com"})
    assert resp.status_code == 400


def test_login_inactive_account(client, db_session):
    user = make_user(password="Passw0rd!", is_active=False)
    resp = client.post("/api/auth/login", json={"email": user.email, "password": "Passw0rd!"})
    assert resp.status_code == 403


def test_totp_full_round_trip(client, db_session, auth_headers):
    user = make_user(password="Passw0rd!")
    headers = auth_headers(user)

    setup_resp = client.post("/api/auth/totp/setup", headers=headers)
    assert setup_resp.status_code == 200
    secret = setup_resp.get_json()["secret"]

    code = pyotp.TOTP(secret).now()
    enable_resp = client.post("/api/auth/totp/enable", json={"code": code}, headers=headers)
    assert enable_resp.status_code == 200
    assert enable_resp.get_json()["totp_enabled"] is True

    login_resp = client.post("/api/auth/login", json={"email": user.email, "password": "Passw0rd!"})
    assert login_resp.status_code == 200
    login_body = login_resp.get_json()
    assert login_body["requires_2fa"] is True
    mfa_token = login_body["mfa_token"]

    verify_code = pyotp.TOTP(secret).now()
    verify_resp = client.post(
        "/api/auth/totp/verify", json={"mfa_token": mfa_token, "code": verify_code}
    )
    assert verify_resp.status_code == 200
    assert "access_token" in verify_resp.get_json()

    disable_code = pyotp.TOTP(secret).now()
    disable_resp = client.post(
        "/api/auth/totp/disable", json={"code": disable_code}, headers=headers
    )
    assert disable_resp.status_code == 200
    assert disable_resp.get_json()["totp_enabled"] is False


def test_totp_enable_rejects_invalid_code(client, db_session, auth_headers):
    user = make_user(password="Passw0rd!")
    headers = auth_headers(user)
    client.post("/api/auth/totp/setup", headers=headers)
    resp = client.post("/api/auth/totp/enable", json={"code": "000000"}, headers=headers)
    assert resp.status_code == 400


def test_refresh_requires_refresh_token(client, db_session):
    user = make_user(password="Passw0rd!")
    login = client.post("/api/auth/login", json={"email": user.email, "password": "Passw0rd!"})
    access_token = login.get_json()["access_token"]

    # An access token must not work on the refresh endpoint.
    resp = client.post(
        "/api/auth/refresh", headers={"Authorization": f"Bearer {access_token}"}
    )
    assert resp.status_code == 422 or resp.status_code == 401

    refresh_token = login.get_json()["refresh_token"]
    resp2 = client.post(
        "/api/auth/refresh", headers={"Authorization": f"Bearer {refresh_token}"}
    )
    assert resp2.status_code == 200
    assert "access_token" in resp2.get_json()


def test_me(client, db_session, auth_headers):
    user = make_user(password="Passw0rd!")
    resp = client.get("/api/auth/me", headers=auth_headers(user))
    assert resp.status_code == 200
    assert resp.get_json()["email"] == user.email


def test_me_requires_auth(client, db_session):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_change_password_wrong_current(client, db_session, auth_headers):
    user = make_user(password="Passw0rd!")
    resp = client.post(
        "/api/auth/change-password",
        json={"current_password": "wrong", "new_password": "NewPassw0rd!"},
        headers=auth_headers(user),
    )
    assert resp.status_code == 400


def test_change_password_weak_new_password(client, db_session, auth_headers):
    user = make_user(password="Passw0rd!")
    resp = client.post(
        "/api/auth/change-password",
        json={"current_password": "Passw0rd!", "new_password": "short"},
        headers=auth_headers(user),
    )
    assert resp.status_code == 400


def test_change_password_success(client, db_session, auth_headers):
    user = make_user(password="Passw0rd!")
    resp = client.post(
        "/api/auth/change-password",
        json={"current_password": "Passw0rd!", "new_password": "NewPassw0rd!"},
        headers=auth_headers(user),
    )
    assert resp.status_code == 200

    relogin = client.post(
        "/api/auth/login", json={"email": user.email, "password": "NewPassw0rd!"}
    )
    assert relogin.status_code == 200


def test_refresh_token_expiry_uses_session_remember_days_setting(client, db_session):
    _set_remember_days("7")

    user = make_user(password="Passw0rd!")
    resp = client.post("/api/auth/login", json={"email": user.email, "password": "Passw0rd!"})
    assert resp.status_code == 200

    exp = _refresh_token_exp(resp.get_json())
    expected = datetime.now(timezone.utc) + timedelta(days=7)
    assert abs((exp - expected).total_seconds()) < 60


def test_refresh_token_expiry_falls_back_to_default_when_setting_is_zero(client, db_session):
    _set_remember_days("0")

    user = make_user(password="Passw0rd!")
    resp = client.post("/api/auth/login", json={"email": user.email, "password": "Passw0rd!"})
    assert resp.status_code == 200

    exp = _refresh_token_exp(resp.get_json())
    # 0 must not mean "expires immediately" - falls back to the fixed 3-day default.
    expected = datetime.now(timezone.utc) + timedelta(days=3)
    assert abs((exp - expected).total_seconds()) < 60


def test_refresh_token_expiry_default_when_setting_unset(client, db_session):
    _set_remember_days(None)

    user = make_user(password="Passw0rd!")
    resp = client.post("/api/auth/login", json={"email": user.email, "password": "Passw0rd!"})
    assert resp.status_code == 200

    exp = _refresh_token_exp(resp.get_json())
    expected = datetime.now(timezone.utc) + timedelta(days=3)
    assert abs((exp - expected).total_seconds()) < 60


def test_totp_remember_device_uses_session_remember_days_setting(client, db_session, auth_headers):
    _set_remember_days("14")

    user = make_user(password="Passw0rd!")
    headers = auth_headers(user)
    secret = client.post("/api/auth/totp/setup", headers=headers).get_json()["secret"]
    client.post("/api/auth/totp/enable", json={"code": pyotp.TOTP(secret).now()}, headers=headers)

    login_resp = client.post("/api/auth/login", json={"email": user.email, "password": "Passw0rd!"})
    mfa_token = login_resp.get_json()["mfa_token"]

    verify_resp = client.post(
        "/api/auth/totp/verify",
        json={"mfa_token": mfa_token, "code": pyotp.TOTP(secret).now(), "remember_me": True},
    )
    assert verify_resp.status_code == 200
    body = verify_resp.get_json()
    assert "device_token" in body

    from app.models import TrustedDevice
    td = TrustedDevice.query.filter_by(token=body["device_token"], user_id=user.id).one()
    expected = datetime.now(timezone.utc) + timedelta(days=14)
    assert abs((td.expires_at - expected).total_seconds()) < 60

    # Also verify the refresh token issued alongside it honors the same setting.
    exp = _refresh_token_exp(body)
    assert abs((exp - expected).total_seconds()) < 60
