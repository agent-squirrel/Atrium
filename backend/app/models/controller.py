from app.extensions import db
from datetime import datetime, timezone
from app.crypto import get_fernet as _get_fernet


class ControllerOwnerType:
    PLATFORM = "platform"
    TENANT = "tenant"


class ControllerAuthMode:
    PASSWORD = "password"
    API_KEY = "api_key"


class ControllerType:
    SELF_HOSTED = "self_hosted"
    CLOUD = "cloud"


class UnifiController(db.Model):
    __tablename__ = "unifi_controllers"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    controller_type = db.Column(db.String(20), nullable=False, default=ControllerType.SELF_HOSTED)
    url = db.Column(db.String(500), nullable=True)
    auth_mode = db.Column(db.String(20), nullable=False, default=ControllerAuthMode.PASSWORD)
    username = db.Column(db.String(200), nullable=True)
    _password_encrypted = db.Column("password_encrypted", db.Text, nullable=True)
    _api_key_encrypted = db.Column("api_key_encrypted", db.Text, nullable=True)
    verify_ssl = db.Column(db.Boolean, default=True, nullable=False)

    # 'platform' = MSP-owned/shared; 'tenant' = belongs to a specific tenant
    owner_type = db.Column(db.String(20), nullable=False, default=ControllerOwnerType.PLATFORM)

    # null when owner_type='platform'
    tenant_id = db.Column(db.Integer, db.ForeignKey("tenants.id"), nullable=True)
    tenant = db.relationship("Tenant", back_populates="controllers")

    is_active = db.Column(db.Boolean, default=True, nullable=False)
    maintenance_mode = db.Column(db.Boolean, default=False, nullable=False)
    sync_interval_hours = db.Column(db.Integer, nullable=True)  # None = disabled
    last_synced_at = db.Column(db.DateTime(timezone=True))
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    sites = db.relationship("UnifiSite", back_populates="controller", lazy="dynamic")

    @property
    def password(self) -> str:
        if not self._password_encrypted:
            return ""
        return _get_fernet().decrypt(self._password_encrypted.encode()).decode()

    @password.setter
    def password(self, plaintext: str):
        if plaintext:
            self._password_encrypted = _get_fernet().encrypt(plaintext.encode()).decode()

    @property
    def api_key(self) -> str:
        if not self._api_key_encrypted:
            return ""
        return _get_fernet().decrypt(self._api_key_encrypted.encode()).decode()

    @api_key.setter
    def api_key(self, plaintext: str):
        if plaintext:
            self._api_key_encrypted = _get_fernet().encrypt(plaintext.encode()).decode()

    @property
    def is_platform_owned(self):
        return self.owner_type == ControllerOwnerType.PLATFORM

    def __repr__(self):
        return f"<UnifiController {self.name} [{self.owner_type}]>"
