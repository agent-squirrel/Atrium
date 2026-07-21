from app.extensions import db


class UserTenantMembership(db.Model):
    __tablename__ = "user_tenant_memberships"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tenant_id = db.Column(
        db.Integer,
        db.ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role = db.Column(db.String(20), nullable=False, default="client")

    __table_args__ = (
        db.UniqueConstraint("user_id", "tenant_id", name="uq_user_tenant_membership"),
    )

    user = db.relationship("User", back_populates="memberships")
    tenant = db.relationship("Tenant")
