from app.extensions import db
from datetime import datetime, timezone


class GuestSession(db.Model):
    __tablename__ = "guest_sessions"

    id = db.Column(db.Integer, primary_key=True)

    portal_id = db.Column(db.Integer, db.ForeignKey("portals.id"), nullable=False)
    portal = db.relationship("Portal", back_populates="guest_sessions")

    # Unifi-supplied identifiers
    mac_address = db.Column(db.String(17), nullable=False, index=True)
    hostname = db.Column(db.String(200))
    ip_address = db.Column(db.String(45))
    ap_mac = db.Column(db.String(17))
    ssid = db.Column(db.String(200))

    # Voucher used (if applicable)
    voucher_id = db.Column(db.Integer, db.ForeignKey("vouchers.id"), nullable=True)
    voucher = db.relationship("Voucher")

    # Captured form data as a key→value dict
    form_data = db.Column(db.JSON, default=dict)

    authorized_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    # Track whether the Unifi API call succeeded
    auth_success = db.Column(db.Boolean, default=False, nullable=False)
    auth_error = db.Column(db.Text)

    def __repr__(self):
        return f"<GuestSession {self.mac_address} @ portal {self.portal_id}>"
