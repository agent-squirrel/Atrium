import os
import uuid
from flask import request, jsonify, current_app
from werkzeug.utils import secure_filename
from PIL import Image
from app.extensions import db
from app.models import Portal
from . import api_bp
from .decorators import require_admin, get_current_user


ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp", "svg"}
MAX_DIMENSION = 4096


def _allowed(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def _save_image(file, subfolder: str) -> str:
    ext = file.filename.rsplit(".", 1)[1].lower()
    unique_name = f"{uuid.uuid4().hex}.{ext}"

    upload_root = os.path.join(
        current_app.root_path, "..", current_app.config["UPLOAD_FOLDER"]
    )
    dest_dir = os.path.join(upload_root, subfolder)
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, unique_name)

    if ext != "svg":
        img = Image.open(file)
        if img.width > MAX_DIMENSION or img.height > MAX_DIMENSION:
            img.thumbnail((MAX_DIMENSION, MAX_DIMENSION))
        img.save(dest_path, optimize=True)
    else:
        file.save(dest_path)

    # Return a URL path relative to static root
    return f"/static/uploads/{subfolder}/{unique_name}"


@api_bp.route("/portals/<int:portal_id>/upload/logo", methods=["POST"])
@require_admin
def upload_logo(portal_id):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal)

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename or not _allowed(file.filename):
        return jsonify({"error": "Invalid file type"}), 400

    path = _save_image(file, f"portals/{portal_id}/logo")
    portal.logo_path = path
    db.session.commit()
    return jsonify({"path": path})


@api_bp.route("/portals/<int:portal_id>/upload/background", methods=["POST"])
@require_admin
def upload_background(portal_id):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal)

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename or not _allowed(file.filename):
        return jsonify({"error": "Invalid file type"}), 400

    path = _save_image(file, f"portals/{portal_id}/background")
    portal.background_image_path = path
    db.session.commit()
    return jsonify({"path": path})


@api_bp.route("/portals/<int:portal_id>/upload/promo_banner", methods=["POST"])
@require_admin
def upload_promo_banner(portal_id):
    portal = Portal.query.get_or_404(portal_id)
    _assert_portal_access(portal)

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename or not _allowed(file.filename):
        return jsonify({"error": "Invalid file type"}), 400

    path = _save_image(file, f"portals/{portal_id}/promo_banner")
    portal.promo_banner_path = path
    db.session.commit()
    return jsonify({"path": path})


def _assert_portal_access(portal: Portal):
    user = get_current_user()
    if user.is_superadmin:
        return
    if portal.site.tenant_id != user.tenant_id:
        from flask import abort
        abort(403)
