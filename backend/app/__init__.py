import os
import click
from flask import Flask, redirect, make_response
from .config import config_map
from .extensions import db, migrate, jwt, ma, limiter


def create_app(env: str | None = None) -> Flask:
    if env is None:
        env = os.environ.get("FLASK_ENV", "development")

    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.config.from_object(config_map.get(env, config_map["development"]))

    # Extensions
    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    ma.init_app(app)
    limiter.init_app(app)

    # Return 401 for all JWT failures so the frontend interceptor handles them uniformly.
    # Flask-JWT-Extended defaults to 422 for invalid/malformed tokens, which the
    # interceptor doesn't recognise as an auth error.
    from flask import jsonify as _jsonify

    @jwt.invalid_token_loader
    def _invalid_token(reason):
        return _jsonify({"error": "Invalid token", "msg": reason}), 401

    @jwt.expired_token_loader
    def _expired_token(_header, _payload):
        return _jsonify({"error": "Token expired"}), 401

    @jwt.unauthorized_loader
    def _missing_token(reason):
        return _jsonify({"error": "Missing token", "msg": reason}), 401

    @jwt.revoked_token_loader
    def _revoked_token(_header, _payload):
        return _jsonify({"error": "Token revoked"}), 401

    # Ensure upload directory exists
    upload_dir = os.path.join(app.root_path, "..", app.config["UPLOAD_FOLDER"])
    os.makedirs(upload_dir, exist_ok=True)

    # Import models so Alembic can discover them
    with app.app_context():
        from .models import (  # noqa: F401
            Tenant, User, UnifiController, UnifiSite, AccessPoint,
            Portal, PortalField, GuestSession, Voucher, PlatformSetting, AuditLog,
            TrustedDevice, UserTenantMembership, EmailSettings,
        )

    # Register API blueprints
    from .api import api_bp
    app.register_blueprint(api_bp, url_prefix="/api")

    # Register portal (guest-facing) blueprints
    from .portal import portal_bp, dispatch_bp
    app.register_blueprint(portal_bp, url_prefix="/p")
    # dispatch_bp mounts /portal - the single URL configured in Unifi controllers
    app.register_blueprint(dispatch_bp)

    # Root URL handler: redirect to configured URL, or fall back to the admin panel
    @app.route("/")
    def _root():
        from urllib.parse import urlparse
        from .models import PlatformSetting
        setting = db.session.get(PlatformSetting, "root_redirect_url")
        if setting and setting.value:
            url = setting.value.strip()
            if not urlparse(url).scheme:
                url = f"https://{url}"
            return redirect(url)
        return redirect("/admin")

    # IP allowlist enforcement for the admin API only.
    # Guest-facing routes (/p/, /portal) and public API endpoints are never restricted.
    _ADMIN_API_PREFIX = "/api/"
    _IP_ALLOWLIST_EXEMPT = (
        "/api/setup/",          # initial setup wizard
        "/api/settings/my-ip",  # used by the settings page itself before saving
    )

    @app.before_request
    def _enforce_admin_ip_allowlist():
        from flask import request as req, jsonify as _json
        if not req.path.startswith(_ADMIN_API_PREFIX):
            return  # guest portal routes (/p/, /portal, /) are never restricted
        if any(req.path.startswith(e) for e in _IP_ALLOWLIST_EXEMPT):
            return
        from .models import PlatformSetting
        setting = db.session.get(PlatformSetting, "admin_allowed_ips")
        if not setting or not setting.value:
            return  # no restriction configured
        import ipaddress
        raw = (req.headers.get("X-Real-IP") or req.remote_addr or "").strip()
        try:
            client = ipaddress.ip_address(raw)
            # Unwrap IPv4-mapped IPv6 addresses (e.g. ::ffff:192.168.1.1)
            if isinstance(client, ipaddress.IPv6Address) and client.ipv4_mapped:
                client = client.ipv4_mapped
            for line in setting.value.splitlines():
                cidr = line.strip()
                if not cidr or cidr.startswith("#"):
                    continue
                try:
                    if client in ipaddress.ip_network(cidr, strict=False):
                        return  # allowed
                except ValueError:
                    continue
        except ValueError:
            return  # unparseable client IP - fail open so misconfigured proxies don't lock everyone out
        return _json({"error": "Access denied", "msg": "Your IP address is not permitted to access the admin panel."}), 403

    # ── Flask CLI management commands ────────────────────────────────────────

    # Start background scheduler (auto-sync controllers).
    # Guard against double-start: Flask debug mode uses a reloader that forks
    # the process; WERKZEUG_RUN_MAIN is only set in the child (the real worker).
    if not app.testing and (not app.debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true"):
        from .scheduler import init_scheduler
        init_scheduler(app)

    @app.cli.command("clear-admin-ip-restriction")
    def _cli_clear_ip():
        """Clear the admin IP allowlist, restoring access from all IP addresses.

        Run this if you have locked yourself out of the admin panel:

            docker compose exec backend flask clear-admin-ip-restriction
        """
        from .models import PlatformSetting
        setting = db.session.get(PlatformSetting, "admin_allowed_ips")
        if setting:
            setting.value = None
            db.session.commit()
        print("Done. Admin IP restriction cleared - all IPs can now access the panel.")

    @app.cli.command("purge-guest-data")
    def _cli_purge_guests():
        """Delete guest sessions that have exceeded their configured retention period.

        Also runs automatically on a schedule - see app/scheduler.py. Safe to
        additionally run via cron if you want it on-demand too:

            docker compose exec backend flask purge-guest-data
        """
        from .api.guests import purge_guest_data
        total = purge_guest_data()
        print(f"Purged {total} guest session(s).")

    @app.cli.command("reset-password")
    @click.argument("email")
    def _cli_reset_password(email):
        """Reset a user's password from the command line.

        Use this if an admin is locked out and there's no one else who can
        reset it for them from the panel:

            docker compose exec backend flask reset-password someone@example.com
        """
        from .models import User
        from .api.users import _check_password

        email = email.lower().strip()
        user = User.query.filter_by(email=email).first()
        if not user:
            print(f"No user found with email {email}")
            return

        password = click.prompt("New password", hide_input=True, confirmation_prompt=True)
        if err := _check_password(password):
            print(f"Error: {err}")
            return

        user.set_password(password)
        db.session.commit()
        print(f"Password updated for {user.email}.")

    @app.cli.command("create-superadmin")
    @click.argument("email")
    def _cli_create_superadmin(email):
        """Create a new superadmin, or promote an existing user to superadmin.

        Use this if the last superadmin account is lost/disabled and the
        setup wizard is no longer available:

            docker compose exec backend flask create-superadmin someone@example.com
        """
        from .models import User, UserRole
        from .api.users import _check_password

        email = email.lower().strip()
        user = User.query.filter_by(email=email).first()

        if user:
            if user.role == UserRole.SUPERADMIN:
                print(f"{user.email} is already a superadmin.")
                return
            if not click.confirm(f"{user.email} already exists with role '{user.role}'. Promote to superadmin?"):
                return
            user.role = UserRole.SUPERADMIN
            user.is_active = True
            db.session.commit()
            print(f"{user.email} promoted to superadmin.")
            return

        first_name = click.prompt("First name", default="", show_default=False)
        last_name = click.prompt("Last name", default="", show_default=False)
        password = click.prompt("Password", hide_input=True, confirmation_prompt=True)
        if err := _check_password(password):
            print(f"Error: {err}")
            return

        user = User(
            email=email,
            first_name=first_name.strip() or None,
            last_name=last_name.strip() or None,
            role=UserRole.SUPERADMIN,
        )
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        print(f"Superadmin {user.email} created.")

    @app.cli.command("purge-expired-2fa-devices")
    def _cli_purge_expired_devices():
        """Delete expired "remember this device" (2FA trust) records.

        These are never cleaned up automatically. Safe to run via cron:

            docker compose exec backend flask purge-expired-2fa-devices
        """
        from .models import TrustedDevice
        from datetime import datetime, timezone
        n = TrustedDevice.query.filter(
            TrustedDevice.expires_at < datetime.now(timezone.utc)
        ).delete(synchronize_session=False)
        db.session.commit()
        print(f"Purged {n} expired trusted device(s).")

    @app.cli.command("purge-expired-vouchers")
    def _cli_purge_expired_vouchers():
        """Delete vouchers that are expired or revoked and were never
        redeemed. Redeemed vouchers (usage_count > 0) are always kept, even
        if since expired/revoked/exhausted - guest sessions reference them
        for history, and the DB would refuse the delete anyway.

        Also runs automatically on a schedule - see app/scheduler.py. Safe to
        additionally run via cron if you want it on-demand too:

            docker compose exec backend flask purge-expired-vouchers
        """
        from .api.vouchers import purge_expired_vouchers
        n = purge_expired_vouchers()
        print(f"Purged {n} unused expired/revoked voucher(s).")

    @app.cli.command("purge-audit-log")
    @click.option("--days", type=int, required=True, help="Delete audit log entries older than this many days.")
    def _cli_purge_audit_log(days):
        """Delete audit log entries older than N days. There is no automatic
        retention policy for the audit log, so this is opt-in only:

            docker compose exec backend flask purge-audit-log --days 365
        """
        from .models import AuditLog
        from datetime import datetime, timezone, timedelta
        if days <= 0:
            print("Error: --days must be a positive number.")
            return
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        n = AuditLog.query.filter(AuditLog.created_at < cutoff).delete(synchronize_session=False)
        db.session.commit()
        print(f"Purged {n} audit log entr{'y' if n == 1 else 'ies'} older than {days} day(s).")

    @app.cli.command("sync-controller")
    @click.argument("name")
    def _cli_sync_controller(name):
        """Manually trigger a UniFi controller sync without waiting for the
        scheduler, useful when debugging a sync issue:

            docker compose exec backend flask sync-controller "Sol"
        """
        from .models import UnifiController
        from .services.unifi import UnifiClient, UnifiError
        from .api.controllers import _do_sync

        matches = UnifiController.query.filter(UnifiController.name.ilike(name)).all()
        if not matches:
            matches = UnifiController.query.filter(UnifiController.name.ilike(f"%{name}%")).all()
        if not matches:
            print(f"No controller found matching {name!r}")
            return
        if len(matches) > 1:
            print(f"Multiple controllers match {name!r} - be more specific:")
            for c in matches:
                print(f"  - {c.name}")
            return

        controller = matches[0]

        try:
            client = UnifiClient(controller)
            client.get_sites()
        except UnifiError as e:
            print(f"Error: {e}")
            return

        result = _do_sync(controller, client)
        if result.get("error"):
            print(f"Error: {result['error']}")
            return
        print(f"Synced {result['synced']} site(s), {result['aps_synced']} access point(s) for {controller.name!r}.")

    return app
