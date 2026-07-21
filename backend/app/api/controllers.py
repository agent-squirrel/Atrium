from flask import request, jsonify
from app.extensions import db
from app.models import UnifiController, UnifiSite, AccessPoint, ControllerOwnerType, ControllerAuthMode, ControllerType, Tenant
from app.services.unifi import UnifiClient, UnifiError, CLOUD_API_BASE
from . import api_bp
from .decorators import require_superadmin, require_admin, get_current_user
from datetime import datetime, timezone


@api_bp.route("/controllers", methods=["GET"])
@require_admin
def list_controllers():
    user = get_current_user()
    q = UnifiController.query
    if not user.is_superadmin:
        # Show platform controllers (all sites visible to them) + their tenant's own controllers
        q = q.filter(
            (UnifiController.owner_type == ControllerOwnerType.PLATFORM) |
            (UnifiController.tenant_id == user.tenant_id)
        )
    controllers = q.order_by(UnifiController.name).all()
    return jsonify([_controller_dict(c) for c in controllers])


@api_bp.route("/controllers", methods=["POST"])
@require_superadmin
def create_controller():
    data = request.get_json(silent=True) or {}

    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400

    controller_type = data.get("controller_type", ControllerType.SELF_HOSTED)
    if controller_type not in (ControllerType.SELF_HOSTED, ControllerType.CLOUD):
        return jsonify({"error": "controller_type must be 'self_hosted' or 'cloud'"}), 400

    owner_type = data.get("owner_type", ControllerOwnerType.PLATFORM)
    if owner_type not in (ControllerOwnerType.PLATFORM, ControllerOwnerType.TENANT):
        return jsonify({"error": "owner_type must be 'platform' or 'tenant'"}), 400

    tenant_id = data.get("tenant_id")
    if owner_type == ControllerOwnerType.TENANT:
        if not tenant_id:
            return jsonify({"error": "tenant_id is required for tenant-owned controllers"}), 400
        if not db.session.get(Tenant, tenant_id):
            return jsonify({"error": "Tenant not found"}), 404
    else:
        tenant_id = None

    sync_interval_hours = _parse_sync_interval(data.get("sync_interval_hours"))
    if isinstance(sync_interval_hours, tuple):
        return sync_interval_hours

    if controller_type == ControllerType.CLOUD:
        api_key = data.get("api_key") or ""
        if not api_key:
            return jsonify({"error": "api_key is required for cloud controllers"}), 400
        controller = UnifiController(
            name=name,
            controller_type=ControllerType.CLOUD,
            url=CLOUD_API_BASE,
            auth_mode=ControllerAuthMode.API_KEY,
            verify_ssl=True,
            owner_type=owner_type,
            tenant_id=tenant_id,
            sync_interval_hours=sync_interval_hours,
        )
        controller.api_key = api_key
    else:
        url = (data.get("url") or "").strip().rstrip("/")
        if not url:
            return jsonify({"error": "url is required"}), 400
        auth_mode = data.get("auth_mode", ControllerAuthMode.PASSWORD)
        if auth_mode not in (ControllerAuthMode.PASSWORD, ControllerAuthMode.API_KEY):
            return jsonify({"error": "auth_mode must be 'password' or 'api_key'"}), 400
        verify_ssl = data.get("verify_ssl", True)

        if auth_mode == ControllerAuthMode.PASSWORD:
            username = (data.get("username") or "").strip()
            password = data.get("password") or ""
            if not username or not password:
                return jsonify({"error": "username and password are required for password auth"}), 400
        else:
            username = None
            api_key = data.get("api_key") or ""
            if not api_key:
                return jsonify({"error": "api_key is required for API key auth"}), 400

        controller = UnifiController(
            name=name,
            controller_type=ControllerType.SELF_HOSTED,
            url=url,
            auth_mode=auth_mode,
            username=username,
            verify_ssl=verify_ssl,
            owner_type=owner_type,
            tenant_id=tenant_id,
            sync_interval_hours=sync_interval_hours,
        )
        if auth_mode == ControllerAuthMode.PASSWORD:
            controller.password = password
        else:
            controller.api_key = api_key

    # Test connection before persisting
    try:
        client = UnifiClient(controller)
        client.get_sites()
    except UnifiError as e:
        return jsonify({"error": f"Connection failed: {e}"}), 502

    db.session.add(controller)
    db.session.commit()

    sync_result = _do_sync(controller, client)
    return jsonify({**_controller_dict(controller), "sync": sync_result}), 201


@api_bp.route("/controllers/<int:controller_id>", methods=["GET"])
@require_admin
def get_controller(controller_id):
    controller = UnifiController.query.get_or_404(controller_id)
    _assert_controller_access(controller)
    return jsonify(_controller_dict(controller))


@api_bp.route("/controllers/<int:controller_id>", methods=["PUT"])
@require_superadmin
def update_controller(controller_id):
    controller = UnifiController.query.get_or_404(controller_id)
    data = request.get_json(silent=True) or {}

    if "name" in data and data["name"].strip():
        controller.name = data["name"].strip()

    is_cloud = controller.controller_type == ControllerType.CLOUD

    if not is_cloud:
        if "url" in data and data["url"].strip():
            controller.url = data["url"].strip().rstrip("/")
        if "auth_mode" in data:
            am = data["auth_mode"]
            if am not in (ControllerAuthMode.PASSWORD, ControllerAuthMode.API_KEY):
                return jsonify({"error": "auth_mode must be 'password' or 'api_key'"}), 400
            controller.auth_mode = am
        if "username" in data:
            controller.username = (data["username"] or "").strip() or None
        if "password" in data and data["password"]:
            controller.password = data["password"]
        if "verify_ssl" in data:
            controller.verify_ssl = bool(data["verify_ssl"])

    if "api_key" in data and data["api_key"]:
        controller.api_key = data["api_key"]
    if "is_active" in data:
        controller.is_active = bool(data["is_active"])
    if "maintenance_mode" in data:
        controller.maintenance_mode = bool(data["maintenance_mode"])
    if "owner_type" in data:
        ot = data["owner_type"]
        if ot not in (ControllerOwnerType.PLATFORM, ControllerOwnerType.TENANT):
            return jsonify({"error": "owner_type must be 'platform' or 'tenant'"}), 400
        controller.owner_type = ot
        if ot == ControllerOwnerType.PLATFORM:
            controller.tenant_id = None
    if "tenant_id" in data and controller.owner_type == ControllerOwnerType.TENANT:
        tid = data["tenant_id"]
        if tid and not db.session.get(Tenant, tid):
            return jsonify({"error": "Tenant not found"}), 404
        controller.tenant_id = tid
    if "sync_interval_hours" in data:
        result = _parse_sync_interval(data["sync_interval_hours"])
        if isinstance(result, tuple):
            return result
        controller.sync_interval_hours = result

    db.session.commit()
    return jsonify(_controller_dict(controller))


@api_bp.route("/controllers/<int:controller_id>", methods=["DELETE"])
@require_superadmin
def delete_controller(controller_id):
    controller = UnifiController.query.get_or_404(controller_id)
    db.session.delete(controller)
    db.session.commit()
    return "", 204


@api_bp.route("/controllers/<int:controller_id>/sync", methods=["POST"])
@require_superadmin
def sync_controller(controller_id):
    """Pull sites from the Unifi controller and upsert them into the local DB."""
    controller = UnifiController.query.get_or_404(controller_id)
    try:
        client = UnifiClient(controller)
        client.get_sites()  # validates connectivity before mutating
    except UnifiError as e:
        return jsonify({"error": str(e)}), 502

    result = _do_sync(controller, client)
    return jsonify(result)


def _do_sync(controller: UnifiController, client: UnifiClient) -> dict:
    """Upsert sites and access points. Returns summary dict."""
    try:
        remote_sites = client.get_sites()
    except UnifiError as e:
        return {"synced": 0, "aps_synced": 0, "sites": [], "error": str(e)}

    synced = []
    for site in remote_sites:
        existing = UnifiSite.query.filter_by(
            controller_id=controller.id,
            unifi_site_id=site["name"],
        ).first()
        if existing:
            existing.name = site.get("desc", site["name"])
            synced.append(existing)
        else:
            auto_tenant = controller.tenant_id if not controller.is_platform_owned else None
            new_site = UnifiSite(
                controller_id=controller.id,
                unifi_site_id=site["name"],
                name=site.get("desc", site["name"]),
                tenant_id=auto_tenant,
            )
            db.session.add(new_site)
            synced.append(new_site)

    controller.last_synced_at = datetime.now(timezone.utc)
    db.session.commit()

    aps_synced = 0
    for site in synced:
        try:
            devices = client.get_devices(site.unifi_site_id)
            for device in devices:
                mac = (device.get("mac") or "").lower().strip()
                if not mac:
                    continue
                ap = AccessPoint.query.filter_by(mac_address=mac).first()
                if ap:
                    ap.site_id = site.id
                    ap.name = device.get("name") or device.get("hostname")
                    ap.model = device.get("model")
                    ap.last_seen_at = datetime.now(timezone.utc)
                else:
                    db.session.add(AccessPoint(
                        mac_address=mac,
                        name=device.get("name") or device.get("hostname"),
                        model=device.get("model"),
                        site_id=site.id,
                    ))
                aps_synced += 1
            db.session.commit()
        except Exception:
            db.session.rollback()

    return {
        "synced": len(synced),
        "aps_synced": aps_synced,
        "sites": [_site_dict(s) for s in synced],
    }


@api_bp.route("/controllers/<int:controller_id>/test", methods=["POST"])
@require_superadmin
def test_controller(controller_id):
    controller = UnifiController.query.get_or_404(controller_id)
    try:
        client = UnifiClient(controller)
        client.get_sites()
        return jsonify({"ok": True, "message": "Connection successful"})
    except UnifiError as e:
        return jsonify({"ok": False, "message": str(e)}), 502


def _parse_sync_interval(raw) -> int | None | tuple:
    """Parse sync_interval_hours from request data. Returns int, None, or (response, status) error tuple."""
    if raw is None or raw == "" or raw == 0:
        return None
    try:
        val = int(raw)
    except (TypeError, ValueError):
        return jsonify({"error": "sync_interval_hours must be an integer"}), 400
    if not (1 <= val <= 168):
        return jsonify({"error": "sync_interval_hours must be between 1 (1 hour) and 168 (1 week)"}), 400
    return val


def _assert_controller_access(controller: UnifiController):
    user = get_current_user()
    if user.is_superadmin:
        return
    if controller.owner_type == ControllerOwnerType.TENANT and controller.tenant_id != user.tenant_id:
        from flask import abort
        abort(403)


def _controller_dict(c: UnifiController) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "controller_type": c.controller_type,
        "url": c.url,
        "auth_mode": c.auth_mode,
        "username": c.username,
        "has_api_key": bool(c._api_key_encrypted),
        "verify_ssl": c.verify_ssl,
        "owner_type": c.owner_type,
        "tenant_id": c.tenant_id,
        "is_active": c.is_active,
        "maintenance_mode": c.maintenance_mode,
        "sync_interval_hours": c.sync_interval_hours,
        "last_synced_at": c.last_synced_at.isoformat() if c.last_synced_at else None,
        "created_at": c.created_at.isoformat(),
    }


def _site_dict(s: UnifiSite) -> dict:
    return {
        "id": s.id,
        "unifi_site_id": s.unifi_site_id,
        "name": s.name,
        "controller_id": s.controller_id,
        "tenant_id": s.tenant_id,
        "is_active": s.is_active,
    }
