from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_jwt_extended import JWTManager
from flask_marshmallow import Marshmallow
from flask_limiter import Limiter

db = SQLAlchemy()
migrate = Migrate()
jwt = JWTManager()
ma = Marshmallow()


def _client_ip():
    from flask import request
    return request.headers.get("X-Real-IP") or request.remote_addr or "unknown"


limiter = Limiter(key_func=_client_ip, default_limits=[], storage_uri="memory://")
