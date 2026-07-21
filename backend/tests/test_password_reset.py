from unittest.mock import patch

from app.api.auth import _reset_serializer
from tests.factories import make_user


def _token_for(user):
    from app.api.auth import _password_fingerprint
    return _reset_serializer().dumps({"uid": user.id, "fp": _password_fingerprint(user)})


def test_forgot_password_always_returns_200_for_unknown_email(client, db_session):
    resp = client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})
    assert resp.status_code == 200


def test_forgot_password_sends_email_for_known_active_user(client, db_session):
    user = make_user(password="Passw0rd!")
    with patch("app.mailer.send_email") as mock_send:
        resp = client.post("/api/auth/forgot-password", json={"email": user.email})
    assert resp.status_code == 200
    mock_send.assert_called_once()
    to, subject, body = mock_send.call_args[0]
    assert to == user.email
    assert "reset-password?token=" in body


def test_forgot_password_does_not_email_inactive_user(client, db_session):
    user = make_user(password="Passw0rd!", is_active=False)
    with patch("app.mailer.send_email") as mock_send:
        resp = client.post("/api/auth/forgot-password", json={"email": user.email})
    assert resp.status_code == 200
    mock_send.assert_not_called()


def test_forgot_password_returns_200_even_if_send_fails(client, db_session):
    user = make_user(password="Passw0rd!")
    with patch("app.mailer.send_email", side_effect=RuntimeError("smtp down")):
        resp = client.post("/api/auth/forgot-password", json={"email": user.email})
    assert resp.status_code == 200


def test_reset_password_happy_path(client, db_session):
    user = make_user(password="Passw0rd!")
    token = _token_for(user)

    resp = client.post("/api/auth/reset-password", json={"token": token, "new_password": "NewPassw0rd!"})
    assert resp.status_code == 200

    relogin = client.post("/api/auth/login", json={"email": user.email, "password": "NewPassw0rd!"})
    assert relogin.status_code == 200


def test_reset_password_rejects_weak_password(client, db_session):
    user = make_user(password="Passw0rd!")
    token = _token_for(user)
    resp = client.post("/api/auth/reset-password", json={"token": token, "new_password": "short"})
    assert resp.status_code == 400


def test_reset_password_rejects_tampered_token(client, db_session):
    make_user(password="Passw0rd!")
    resp = client.post("/api/auth/reset-password", json={"token": "not-a-real-token", "new_password": "NewPassw0rd!"})
    assert resp.status_code == 400


def test_reset_password_token_is_single_use(client, db_session):
    user = make_user(password="Passw0rd!")
    token = _token_for(user)

    first = client.post("/api/auth/reset-password", json={"token": token, "new_password": "NewPassw0rd!"})
    assert first.status_code == 200

    # Same token again - the fingerprint no longer matches the (now-changed) password hash.
    second = client.post("/api/auth/reset-password", json={"token": token, "new_password": "AnotherPassw0rd!"})
    assert second.status_code == 400


def test_reset_password_rejects_missing_fields(client, db_session):
    resp = client.post("/api/auth/reset-password", json={"token": "x"})
    assert resp.status_code == 400
