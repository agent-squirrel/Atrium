import os
from urllib.parse import urlparse

import pytest
from cryptography.fernet import Fernet

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://atrium_user:ukdeNaRtsATUH78s-qD28mOXKiLSHPXT@db:5432/captive_portal_test",
)

# Set at conftest import time (before pytest collects sibling test modules) -
# TestingConfig.SQLALCHEMY_DATABASE_URI is a class attribute evaluated on the
# first `from app...` import anywhere, which can happen during collection,
# before the `app` fixture below ever runs. Setting these later is too late.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret")


def _ensure_test_db_exists(url: str) -> None:
    import psycopg2

    parsed = urlparse(url)
    dbname = parsed.path.lstrip("/")
    admin_url = url.rsplit("/", 1)[0] + "/postgres"

    conn = psycopg2.connect(admin_url)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,))
            if not cur.fetchone():
                cur.execute(f'CREATE DATABASE "{dbname}"')
    finally:
        conn.close()


@pytest.fixture(scope="session")
def app():
    _ensure_test_db_exists(TEST_DATABASE_URL)

    from app import create_app
    from app.extensions import db as _db

    flask_app = create_app("testing")

    with flask_app.app_context():
        _db.create_all()
        yield flask_app
        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def db_session(app):
    from app.extensions import db as _db
    from sqlalchemy import event

    with app.app_context():
        connection = _db.engine.connect()
        outer_transaction = connection.begin()
        _db.session.bind = connection
        nested = connection.begin_nested()

        @event.listens_for(_db.session, "after_transaction_end")
        def _restart_savepoint(session, transaction):
            nonlocal nested
            if not nested.is_active:
                nested = connection.begin_nested()

        yield _db.session

        event.remove(_db.session, "after_transaction_end", _restart_savepoint)
        _db.session.remove()
        outer_transaction.rollback()
        connection.close()


@pytest.fixture
def client(app, db_session):
    return app.test_client()


@pytest.fixture
def auth_headers(app, db_session):
    def _make(user):
        with app.app_context():
            from flask_jwt_extended import create_access_token
            token = create_access_token(identity=str(user.id))
        return {"Authorization": f"Bearer {token}"}
    return _make
