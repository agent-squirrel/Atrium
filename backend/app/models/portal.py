from app.extensions import db
from datetime import datetime, timezone
import secrets
import string


def _generate_slug(length=10):
    alphabet = string.ascii_lowercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


class AuthType:
    CLICK_THROUGH = "click_through"
    VOUCHER = "voucher"
    BOTH = "both"
    ALL = [CLICK_THROUGH, VOUCHER, BOTH]


class FieldType:
    TEXT = "text"
    EMAIL = "email"
    PHONE = "phone"
    NUMBER = "number"
    CHECKBOX = "checkbox"
    SELECT = "select"
    TEXTAREA = "textarea"
    ALL = [TEXT, EMAIL, PHONE, NUMBER, CHECKBOX, SELECT, TEXTAREA]


class Layout:
    CENTERED = "centered"
    SPLIT = "split"
    ALL = [CENTERED, SPLIT]


# Curated allowlist (not free text) - keeps guest-page <link> tags and CSS safe,
# and keeps the picker to fonts that are actually good defaults for a form UI.
GOOGLE_FONTS = [
    "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins",
    "Nunito", "Raleway", "Playfair Display", "Merriweather",
    "Source Sans 3", "Work Sans", "DM Sans", "Space Grotesk", "Oswald",
]


class Portal(db.Model):
    __tablename__ = "portals"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    slug = db.Column(db.String(20), unique=True, nullable=False, default=_generate_slug)

    site_id = db.Column(db.Integer, db.ForeignKey("unifi_sites.id"), nullable=False)
    site = db.relationship("UnifiSite", back_populates="portals")

    # Optional: restrict this portal to specific SSIDs within the site.
    # Empty/null list = applies to all SSIDs on the site.
    ssids = db.Column(db.JSON, default=list, nullable=False)

    auth_type = db.Column(db.String(20), nullable=False, default=AuthType.CLICK_THROUGH)
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    # Branding
    logo_path = db.Column(db.String(500))
    background_image_path = db.Column(db.String(500))
    primary_color = db.Column(db.String(7), default="#3B82F6")
    secondary_color = db.Column(db.String(7), default="#1E40AF")
    font_family = db.Column(db.String(100), default="Inter")
    layout = db.Column(db.String(20), nullable=False, default=Layout.CENTERED)
    # Card background opacity, 0-100. Lower values reveal more of the
    # background image/gradient through a blurred "glass" card.
    card_opacity = db.Column(db.Integer, default=97, nullable=False)

    # Content
    welcome_heading = db.Column(db.String(200), default="Welcome")
    welcome_text = db.Column(db.Text)
    disclaimer = db.Column(db.Text)
    button_label = db.Column(db.String(100), default="Connect")

    # Compliance: an explicit opt-in checkbox, distinct from the passive
    # disclaimer text above. terms_url, if set, makes the checkbox label a link.
    require_terms_acceptance = db.Column(db.Boolean, default=False, nullable=False)
    terms_checkbox_label = db.Column(db.String(300), default="I agree to the Terms & Conditions")
    terms_url = db.Column(db.String(500))

    # Social links shown in the guest page footer (nullable - only shown if set)
    social_facebook = db.Column(db.String(500))
    social_instagram = db.Column(db.String(500))
    social_twitter_x = db.Column(db.String(500))
    social_tiktok = db.Column(db.String(500))

    # Post-connect page (shown after a guest successfully authenticates)
    post_connect_heading = db.Column(db.String(200), default="You're Connected!")
    post_connect_text = db.Column(db.Text)
    promo_banner_path = db.Column(db.String(500))
    promo_banner_link = db.Column(db.String(500))

    # After-auth redirect (falls back to Unifi's supplied redirect URL if blank)
    redirect_url = db.Column(db.String(500))
    # Countdown (seconds) shown on the post-connect page before the guest is
    # actually authorized with the UniFi controller (and, if redirect_url is
    # set, before auto-redirecting there afterward). Always applies, even with
    # no redirect_url - deferring authorization until this elapses guarantees
    # the post-connect page is visible for at least this long, since some
    # devices auto-close the captive-portal browser the instant they detect
    # real internet access.
    connect_delay_seconds = db.Column(db.Integer, default=5, nullable=False)

    # Session duration in minutes sent to Unifi (0 = controller default)
    session_duration = db.Column(db.Integer, default=0)

    # Bandwidth limits in kbps sent to Unifi (null = use global default)
    rate_limit_down = db.Column(db.Integer, nullable=True)
    rate_limit_up = db.Column(db.Integer, nullable=True)

    # Guest session data retention in days (null = use global default)
    data_retention_days = db.Column(db.Integer, nullable=True)

    maintenance_mode = db.Column(db.Boolean, default=False, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    fields = db.relationship(
        "PortalField", back_populates="portal", lazy="dynamic",
        order_by="PortalField.order", cascade="all, delete-orphan"
    )
    guest_sessions = db.relationship("GuestSession", back_populates="portal", lazy="dynamic")
    vouchers = db.relationship("Voucher", back_populates="portal", lazy="dynamic")

    def __repr__(self):
        return f"<Portal {self.name} ({self.slug})>"


class PortalField(db.Model):
    __tablename__ = "portal_fields"

    id = db.Column(db.Integer, primary_key=True)
    portal_id = db.Column(db.Integer, db.ForeignKey("portals.id"), nullable=False)
    portal = db.relationship("Portal", back_populates="fields")

    label = db.Column(db.String(200), nullable=False)
    field_key = db.Column(db.String(100), nullable=False)  # snake_case identifier for stored data
    field_type = db.Column(db.String(20), nullable=False, default=FieldType.TEXT)
    placeholder = db.Column(db.String(200))
    is_required = db.Column(db.Boolean, default=False, nullable=False)
    # JSON list of option strings for SELECT type
    options = db.Column(db.JSON)
    order = db.Column(db.Integer, default=0, nullable=False)

    __table_args__ = (
        db.UniqueConstraint("portal_id", "field_key", name="uq_portal_field_key"),
    )

    def __repr__(self):
        return f"<PortalField {self.label} [{self.field_type}]>"
