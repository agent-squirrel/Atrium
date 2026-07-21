from app.extensions import db
from datetime import datetime, timezone
import secrets
import string


def _generate_code(length=8):
    alphabet = string.ascii_uppercase + string.digits
    # Remove ambiguous characters
    alphabet = alphabet.translate(str.maketrans("", "", "0O1IL"))
    return "".join(secrets.choice(alphabet) for _ in range(length))


class Voucher(db.Model):
    __tablename__ = "vouchers"

    id = db.Column(db.Integer, primary_key=True)

    portal_id = db.Column(db.Integer, db.ForeignKey("portals.id"), nullable=False)
    portal = db.relationship("Portal", back_populates="vouchers")

    code = db.Column(db.String(20), nullable=False, index=True, default=_generate_code)

    # 0 = unlimited uses
    usage_limit = db.Column(db.Integer, default=1, nullable=False)
    usage_count = db.Column(db.Integer, default=0, nullable=False)

    # Session duration in minutes this voucher grants (overrides portal default if set)
    duration_minutes = db.Column(db.Integer, default=60, nullable=False)

    # Optional bandwidth limits (kbps), None = unlimited
    rate_limit_down = db.Column(db.Integer)
    rate_limit_up = db.Column(db.Integer)

    is_active = db.Column(db.Boolean, default=True, nullable=False)
    expires_at = db.Column(db.DateTime(timezone=True))

    created_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    created_by = db.relationship("User")
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    note = db.Column(db.String(500))

    __table_args__ = (
        db.UniqueConstraint("portal_id", "code", name="uq_portal_voucher_code"),
    )

    @property
    def is_valid(self) -> bool:
        if not self.is_active:
            return False
        if self.expires_at and self.expires_at < datetime.now(timezone.utc):
            return False
        if self.usage_limit > 0 and self.usage_count >= self.usage_limit:
            return False
        return True

    def __repr__(self):
        return f"<Voucher {self.code} (used {self.usage_count}/{self.usage_limit})>"
