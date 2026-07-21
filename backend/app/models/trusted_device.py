import secrets
from datetime import datetime, timezone
from app.extensions import db


class TrustedDevice(db.Model):
    __tablename__ = "trusted_devices"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token = db.Column(db.String(64), unique=True, nullable=False, index=True)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    @staticmethod
    def generate_token() -> str:
        return secrets.token_urlsafe(32)

    @property
    def is_expired(self) -> bool:
        return datetime.now(timezone.utc) > self.expires_at
