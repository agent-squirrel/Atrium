from app.extensions import db
from app.crypto import get_fernet


class EmailEncryption:
    NONE = "none"
    STARTTLS = "starttls"
    SSL = "ssl"

    ALL = [NONE, STARTTLS, SSL]


class EmailSettings(db.Model):
    """Singleton row (always id=1) holding the platform's outbound SMTP config."""

    __tablename__ = "email_settings"

    id = db.Column(db.Integer, primary_key=True)
    enabled = db.Column(db.Boolean, default=False, nullable=False)
    smtp_host = db.Column(db.String(255), nullable=True)
    smtp_port = db.Column(db.Integer, nullable=True)
    smtp_username = db.Column(db.String(255), nullable=True)
    _smtp_password_encrypted = db.Column("smtp_password_encrypted", db.Text, nullable=True)
    from_address = db.Column(db.String(255), nullable=True)
    from_name = db.Column(db.String(255), nullable=True)
    encryption = db.Column(db.String(20), nullable=False, default=EmailEncryption.STARTTLS)

    @property
    def smtp_password(self) -> str:
        if not self._smtp_password_encrypted:
            return ""
        return get_fernet().decrypt(self._smtp_password_encrypted.encode()).decode()

    @smtp_password.setter
    def smtp_password(self, plaintext: str):
        if plaintext:
            self._smtp_password_encrypted = get_fernet().encrypt(plaintext.encode()).decode()

    @classmethod
    def get_or_create(cls) -> "EmailSettings":
        settings = db.session.get(cls, 1)
        if not settings:
            settings = cls(id=1)
            db.session.add(settings)
            db.session.commit()
        return settings

    def __repr__(self):
        return f"<EmailSettings host={self.smtp_host!r} enabled={self.enabled}>"
