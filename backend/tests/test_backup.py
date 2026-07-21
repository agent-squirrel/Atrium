import json
import zipfile
import io

import pytest

from app.extensions import db
from app.models import (
    User, UserRole, EmailSettings, PortalField, FieldType, Tenant,
)
from app.backup import create_backup, restore_backup, BackupError, MAGIC
from tests.factories import (
    make_user, make_tenant, make_controller, make_site, make_portal,
    make_voucher, make_guest_session,
)


@pytest.fixture
def isolated_uploads(app, monkeypatch, tmp_path):
    """Redirect UPLOAD_FOLDER to a throwaway tmp dir so backup/restore tests
    never touch the real uploads volume (restore_backup wipes and rewrites
    the whole upload root, which would be catastrophic against real data)."""
    monkeypatch.setitem(app.config, "UPLOAD_FOLDER", str(tmp_path))
    return tmp_path


def _wipe_all_tables():
    """Leave the DB empty after a test that calls restore_backup(), since its
    internal commits escape this project's savepoint-rollback test isolation
    (same gap documented for session_remember_days / email_settings)."""
    from app.backup import _table_to_model_map
    table_to_model = _table_to_model_map()
    names = [t.name for t in db.metadata.sorted_tables if t.name in table_to_model]
    if names:
        quoted = ", ".join(f'"{n}"' for n in names)
        db.session.execute(db.text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))
        db.session.commit()


def _build_dataset():
    tenant = make_tenant()
    admin = make_user(tenant=tenant, role=UserRole.SUPERADMIN, password="Passw0rd!")
    controller = make_controller(tenant=tenant)
    controller.password = "real-unifi-password"
    site = make_site(controller, tenant=tenant)
    portal = make_portal(site, name="Test Portal")
    field = PortalField(portal_id=portal.id, label="Full name", field_key="full_name", field_type=FieldType.TEXT)
    db.session.add(field)
    voucher = make_voucher(portal, code="TESTCODE1")
    make_guest_session(portal, mac_address="AA:BB:CC:DD:EE:01")

    email_settings = EmailSettings.get_or_create()
    email_settings.smtp_host = "smtp.example.com"
    email_settings.smtp_password = "real-smtp-password"
    db.session.commit()

    return {
        "tenant_id": tenant.id, "admin_id": admin.id, "controller_id": controller.id,
        "site_id": site.id, "portal_id": portal.id, "field_id": field.id,
        "voucher_id": voucher.id,
    }


def test_backup_unencrypted_contains_decrypted_secrets_not_ciphertext(app, db_session, isolated_uploads):
    ids = _build_dataset()
    blob = create_backup(password=None)

    assert blob[:8] == MAGIC
    assert blob[9] == 0  # not encrypted

    zf = zipfile.ZipFile(io.BytesIO(blob[10:]))
    data = json.loads(zf.read("data.json"))

    controller_row = next(r for r in data["unifi_controllers"] if r["id"] == ids["controller_id"])
    assert controller_row["password_plain"] == "real-unifi-password"
    assert "password_encrypted" not in controller_row

    email_row = data["email_settings"][0]
    assert email_row["smtp_password_plain"] == "real-smtp-password"
    assert "smtp_password_encrypted" not in email_row

    _wipe_all_tables()


def test_restore_rejects_when_superadmin_already_exists(app, db_session, isolated_uploads):
    _build_dataset()
    blob = create_backup(password=None)

    with pytest.raises(BackupError, match="before initial setup"):
        restore_backup(blob, password=None)

    _wipe_all_tables()


def test_restore_round_trip(app, db_session, isolated_uploads):
    ids = _build_dataset()

    # An uploaded file the backup should carry over.
    portal_dir = isolated_uploads / "portals" / str(ids["portal_id"]) / "logo"
    portal_dir.mkdir(parents=True)
    (portal_dir / "logo.png").write_bytes(b"fake-png-bytes")

    blob = create_backup(password=None)

    # Simulate "fresh install": no superadmin exists.
    db.session.delete(db.session.get(User, ids["admin_id"]))
    db.session.commit()

    restore_backup(blob, password=None)

    # Data survived, with original IDs intact.
    tenant = db.session.get(Tenant, ids["tenant_id"])
    assert tenant is not None
    admin = User.query.filter_by(role=UserRole.SUPERADMIN).first()
    assert admin is not None
    assert admin.id == ids["admin_id"]

    from app.models import UnifiController, Portal, PortalField as PF, Voucher, GuestSession
    controller = db.session.get(UnifiController, ids["controller_id"])
    assert controller.password == "real-unifi-password"  # re-encrypted + decryptable
    portal = db.session.get(Portal, ids["portal_id"])
    assert portal.name == "Test Portal"
    field = db.session.get(PF, ids["field_id"])
    assert field.field_key == "full_name"
    voucher = db.session.get(Voucher, ids["voucher_id"])
    assert voucher.code == "TESTCODE1"
    assert GuestSession.query.filter_by(portal_id=ids["portal_id"]).count() == 1

    email_settings = EmailSettings.get_or_create()
    assert email_settings.smtp_password == "real-smtp-password"

    # Uploaded file round-tripped.
    restored_file = isolated_uploads / "portals" / str(ids["portal_id"]) / "logo" / "logo.png"
    assert restored_file.read_bytes() == b"fake-png-bytes"

    # Sequence was correctly reset - a brand new row must not collide with restored IDs.
    new_tenant = make_tenant()
    assert new_tenant.id > ids["tenant_id"]

    _wipe_all_tables()


def test_restore_with_password_wrong_password_rejected(app, db_session, isolated_uploads):
    _build_dataset()
    blob = create_backup(password="correct-horse-battery-staple")

    db.session.delete(User.query.filter_by(role=UserRole.SUPERADMIN).first())
    db.session.commit()

    with pytest.raises(BackupError, match="Incorrect password"):
        restore_backup(blob, password="wrong-password")

    _wipe_all_tables()


def test_restore_with_password_missing_password_rejected(app, db_session, isolated_uploads):
    _build_dataset()
    blob = create_backup(password="correct-horse-battery-staple")

    db.session.delete(User.query.filter_by(role=UserRole.SUPERADMIN).first())
    db.session.commit()

    with pytest.raises(BackupError, match="password-protected"):
        restore_backup(blob, password=None)

    _wipe_all_tables()


def test_restore_with_correct_password_succeeds(app, db_session, isolated_uploads):
    ids = _build_dataset()
    blob = create_backup(password="correct-horse-battery-staple")

    db.session.delete(db.session.get(User, ids["admin_id"]))
    db.session.commit()

    restore_backup(blob, password="correct-horse-battery-staple")

    assert User.query.filter_by(role=UserRole.SUPERADMIN).first() is not None

    _wipe_all_tables()


def test_restore_rejects_schema_mismatch(app, db_session, isolated_uploads):
    _build_dataset()
    blob = create_backup(password=None)

    db.session.delete(User.query.filter_by(role=UserRole.SUPERADMIN).first())
    db.session.commit()

    # Tamper with the manifest's schema_revision inside the zip.
    header, zip_bytes = blob[:10], blob[10:]
    zf_in = zipfile.ZipFile(io.BytesIO(zip_bytes))
    manifest = json.loads(zf_in.read("manifest.json"))
    manifest["schema_revision"] = "not-a-real-revision"
    data = zf_in.read("data.json")

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf_out:
        zf_out.writestr("manifest.json", json.dumps(manifest))
        zf_out.writestr("data.json", data)
    tampered = header + out.getvalue()

    with pytest.raises(BackupError, match="different app version"):
        restore_backup(tampered, password=None)

    _wipe_all_tables()


def test_restore_rejects_garbage_file(app, db_session, isolated_uploads):
    with pytest.raises(BackupError, match="valid Atrium backup"):
        restore_backup(b"not a real backup file", password=None)
