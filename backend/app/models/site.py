from app.extensions import db
from datetime import datetime, timezone


class UnifiSite(db.Model):
    __tablename__ = "unifi_sites"

    id = db.Column(db.Integer, primary_key=True)

    # The internal site ID as used by the Unifi controller (e.g. "default" or a hash)
    unifi_site_id = db.Column(db.String(100), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.String(500))

    controller_id = db.Column(db.Integer, db.ForeignKey("unifi_controllers.id"), nullable=False)
    controller = db.relationship("UnifiController", back_populates="sites")

    # Which tenant this site belongs to (always set, even for platform-controller sites)
    tenant_id = db.Column(db.Integer, db.ForeignKey("tenants.id"), nullable=True)
    tenant = db.relationship("Tenant", back_populates="sites")

    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    portals = db.relationship("Portal", back_populates="site", lazy="dynamic")
    access_points = db.relationship("AccessPoint", back_populates="site", lazy="dynamic")

    __table_args__ = (
        db.UniqueConstraint("controller_id", "unifi_site_id", name="uq_controller_site"),
    )

    def __repr__(self):
        return f"<UnifiSite {self.name} ({self.unifi_site_id})>"
