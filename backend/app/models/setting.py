from app.extensions import db


class PlatformSetting(db.Model):
    __tablename__ = "platform_settings"

    key = db.Column(db.String(100), primary_key=True)
    value = db.Column(db.Text, nullable=True)

    def __repr__(self):
        return f"<PlatformSetting {self.key}={self.value!r}>"
