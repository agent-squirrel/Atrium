import itertools
from datetime import datetime, timedelta, timezone

from app.extensions import db
from app.models import (
    Tenant, User, UserRole, UnifiController, ControllerOwnerType, ControllerType,
    UnifiSite, Portal, AuthType, Voucher, GuestSession,
)

_counter = itertools.count(1)


def make_tenant(**kwargs):
    n = next(_counter)
    kwargs.setdefault("name", f"Tenant {n}")
    tenant = Tenant(**kwargs)
    db.session.add(tenant)
    db.session.commit()
    return tenant


def make_user(tenant=None, role=UserRole.CLIENT, password="Passw0rd!", **kwargs):
    n = next(_counter)
    kwargs.setdefault("email", f"user{n}@example.com")
    user = User(role=role, tenant=tenant, **kwargs)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    return user


def make_controller(tenant=None, owner_type=ControllerOwnerType.TENANT, **kwargs):
    n = next(_counter)
    kwargs.setdefault("name", f"Controller {n}")
    kwargs.setdefault("controller_type", ControllerType.SELF_HOSTED)
    kwargs.setdefault("url", "https://unifi.example.com")
    controller = UnifiController(owner_type=owner_type, tenant=tenant, **kwargs)
    controller.username = "admin"
    controller.password = "unifi-pass"
    db.session.add(controller)
    db.session.commit()
    return controller


def make_site(controller, tenant=None, **kwargs):
    n = next(_counter)
    kwargs.setdefault("unifi_site_id", f"site{n}")
    kwargs.setdefault("name", f"Site {n}")
    site = UnifiSite(controller=controller, tenant=tenant, **kwargs)
    db.session.add(site)
    db.session.commit()
    return site


def make_portal(site, **kwargs):
    n = next(_counter)
    kwargs.setdefault("name", f"Portal {n}")
    kwargs.setdefault("auth_type", AuthType.BOTH)
    portal = Portal(site=site, **kwargs)
    db.session.add(portal)
    db.session.commit()
    return portal


def make_voucher(portal, **kwargs):
    voucher = Voucher(portal=portal, **kwargs)
    db.session.add(voucher)
    db.session.commit()
    return voucher


def make_guest_session(portal, mac_address="AA:BB:CC:DD:EE:FF", **kwargs):
    kwargs.setdefault("authorized_at", datetime.now(timezone.utc))
    kwargs.setdefault("auth_success", True)
    session = GuestSession(portal=portal, mac_address=mac_address, **kwargs)
    db.session.add(session)
    db.session.commit()
    return session


def make_tenant_stack(tenant_role=UserRole.ADMIN):
    """Convenience: tenant + admin user + controller + site + portal, wired together."""
    tenant = make_tenant()
    user = make_user(tenant=tenant, role=tenant_role)
    controller = make_controller(tenant=tenant)
    site = make_site(controller, tenant=tenant)
    portal = make_portal(site)
    return tenant, user, controller, site, portal
