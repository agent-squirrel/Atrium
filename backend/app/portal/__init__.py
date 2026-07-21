from flask import Blueprint

portal_bp = Blueprint("portal", __name__)
dispatch_bp = Blueprint("dispatch", __name__)

from . import routes, dispatch  # noqa: E402, F401
