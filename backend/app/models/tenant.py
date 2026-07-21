from app.extensions import db
from datetime import datetime, timezone
import re


def _slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_-]+", "-", slug)
    return slug


class Tenant(db.Model):
    __tablename__ = "tenants"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    slug = db.Column(db.String(200), unique=True, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    users = db.relationship("User", back_populates="tenant", lazy="dynamic")
    controllers = db.relationship("UnifiController", back_populates="tenant", lazy="dynamic")
    sites = db.relationship("UnifiSite", back_populates="tenant", lazy="dynamic")

    def __init__(self, **kwargs):
        if "slug" not in kwargs and "name" in kwargs:
            kwargs["slug"] = _slugify(kwargs["name"])
        super().__init__(**kwargs)

    def __repr__(self):
        return f"<Tenant {self.name}>"
