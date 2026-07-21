from app.extensions import db
from datetime import datetime, timezone
from werkzeug.security import generate_password_hash, check_password_hash


class UserRole:
    SUPERADMIN = "superadmin"
    ADMIN = "admin"
    CLIENT = "client"

    ALL = [SUPERADMIN, ADMIN, CLIENT]


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(254), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(256), nullable=False)
    first_name = db.Column(db.String(100))
    last_name = db.Column(db.String(100))
    role = db.Column(db.String(20), nullable=False, default=UserRole.CLIENT)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    last_login_at = db.Column(db.DateTime(timezone=True))

    totp_secret = db.Column(db.String(32), nullable=True)
    totp_enabled = db.Column(db.Boolean, default=False, nullable=False)

    tenant_id = db.Column(db.Integer, db.ForeignKey("tenants.id"), nullable=True)
    tenant = db.relationship("Tenant", back_populates="users")
    memberships = db.relationship(
        "UserTenantMembership",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    def set_password(self, password: str):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    @property
    def is_superadmin(self):
        return self.role == UserRole.SUPERADMIN

    @property
    def is_admin_or_above(self):
        return self.role in (UserRole.SUPERADMIN, UserRole.ADMIN)

    @property
    def full_name(self):
        return f"{self.first_name or ''} {self.last_name or ''}".strip() or self.email

    def __repr__(self):
        return f"<User {self.email} [{self.role}]>"
