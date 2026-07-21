import os
from datetime import timedelta


class Config:
    APP_VERSION = os.environ.get("APP_VERSION", "0.0.0-dev")

    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-me")
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-jwt-secret-change-me")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=1)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=3)

    # Host/port are fixed by docker-compose.yml's network ("db" is the service
    # name, resolvable via Compose's embedded DNS regardless of container_name);
    # only the credentials come from env.
    SQLALCHEMY_DATABASE_URI = (
        f"postgresql://{os.environ.get('POSTGRES_USER')}:{os.environ.get('POSTGRES_PASSWORD')}"
        f"@db:5432/{os.environ.get('POSTGRES_DB')}"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    UPLOAD_FOLDER = "app/static/uploads"
    MAX_CONTENT_LENGTH = 100 * 1024 * 1024  # raised from 5MB to fit full-site backup uploads
    ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp", "svg"}

    ENCRYPTION_KEY = os.environ.get("ENCRYPTION_KEY", "")


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False


class TestingConfig(Config):
    TESTING = True
    RATELIMIT_ENABLED = False
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL", "postgresql://captive:captive@localhost:5432/captive_portal_test"
    )


config_map = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "testing": TestingConfig,
}
