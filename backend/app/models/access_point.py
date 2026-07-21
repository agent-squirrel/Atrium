from app.extensions import db
from datetime import datetime, timezone


class AccessPoint(db.Model):
    __tablename__ = "access_points"

    id = db.Column(db.Integer, primary_key=True)
    mac_address = db.Column(db.String(17), nullable=False, index=True)
    name = db.Column(db.String(200))
    model = db.Column(db.String(100))

    site_id = db.Column(db.Integer, db.ForeignKey("unifi_sites.id"), nullable=False)
    site = db.relationship("UnifiSite", back_populates="access_points")

    last_seen_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        db.UniqueConstraint("mac_address", name="access_points_mac_address_key"),
    )

    def __repr__(self):
        return f"<AccessPoint {self.mac_address} site={self.site_id}>"
