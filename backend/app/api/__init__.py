from flask import Blueprint

api_bp = Blueprint("api", __name__)

from . import auth, users, tenants, controllers, sites, portals, guests, vouchers, uploads, setup, settings, audit, dashboard  # noqa: E402, F401
