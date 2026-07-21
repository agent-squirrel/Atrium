"""Full-site backup/restore: every DB row plus uploaded files, packed into a
single optionally password-protected file. See docs/plan for the container
format. Restore is only ever allowed pre-setup (no superadmin exists yet) -
this is a fresh-install tool, not a live-data-replacement one.
"""
import base64
import io
import json
import os
import shutil
import zipfile
from datetime import datetime, timezone

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from flask import current_app
from sqlalchemy import text

from app.extensions import db

MAGIC = b"ATRIUMBK"
FORMAT_VERSION = 1
PBKDF2_ITERATIONS = 480_000

# Columns that hold Fernet-encrypted secrets: skipped from the generic dump/
# restore loop and instead round-tripped through their decrypt/encrypt
# property, so a restored backup is re-encrypted under whatever
# ENCRYPTION_KEY is live on the target install rather than the source's.
_SECRET_FIELDS = {
    "unifi_controllers": [("password_encrypted", "password"), ("api_key_encrypted", "api_key")],
    "email_settings": [("smtp_password_encrypted", "smtp_password")],
}


class BackupError(Exception):
    pass


def _table_to_model_map() -> dict:
    return {m.class_.__tablename__: m.class_ for m in db.Model.registry.mappers}


def _upload_root() -> str:
    return os.path.join(current_app.root_path, "..", current_app.config["UPLOAD_FOLDER"])


def _derive_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=PBKDF2_ITERATIONS)
    return base64.urlsafe_b64encode(kdf.derive(password.encode()))


def _current_schema_revision() -> str | None:
    try:
        return db.session.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except Exception:
        db.session.rollback()
        return None


def create_backup(password: str | None = None) -> bytes:
    table_to_model = _table_to_model_map()
    data = {}

    for table in db.metadata.sorted_tables:
        model = table_to_model.get(table.name)
        if model is None:
            continue
        secret_fields = _SECRET_FIELDS.get(table.name, [])
        skip_cols = {col for col, _ in secret_fields}

        rows = []
        for obj in model.query.all():
            row = {}
            for col in table.columns:
                if col.name in skip_cols:
                    continue
                val = getattr(obj, col.name)
                if isinstance(val, datetime):
                    val = val.isoformat()
                row[col.name] = val
            for col_name, prop_name in secret_fields:
                row[f"{prop_name}_plain"] = getattr(obj, prop_name)
            rows.append(row)
        data[table.name] = rows

    manifest = {
        "format_version": FORMAT_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "schema_revision": _current_schema_revision(),
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest))
        zf.writestr("data.json", json.dumps(data, default=str))
        upload_root = _upload_root()
        if os.path.isdir(upload_root):
            for dirpath, _dirnames, filenames in os.walk(upload_root):
                for fname in filenames:
                    full = os.path.join(dirpath, fname)
                    rel = os.path.relpath(full, upload_root)
                    zf.write(full, arcname=os.path.join("uploads", rel))
    zip_bytes = buf.getvalue()

    if password:
        salt = os.urandom(16)
        key = _derive_key(password, salt)
        payload = Fernet(key).encrypt(zip_bytes)
        return MAGIC + bytes([FORMAT_VERSION, 1]) + salt + payload
    return MAGIC + bytes([FORMAT_VERSION, 0]) + zip_bytes


def restore_backup(file_bytes: bytes, password: str | None = None) -> None:
    from app.models import User, UserRole

    if User.query.filter_by(role=UserRole.SUPERADMIN).first():
        raise BackupError("Restore is only available before initial setup is completed.")

    if len(file_bytes) < 10 or file_bytes[:8] != MAGIC:
        raise BackupError("This doesn't look like a valid Atrium backup file.")

    version = file_bytes[8]
    encrypted = bool(file_bytes[9])
    if version != FORMAT_VERSION:
        raise BackupError("This backup was created with an incompatible format version.")

    offset = 10
    if encrypted:
        if not password:
            raise BackupError("This backup is password-protected - enter the password.")
        salt = file_bytes[offset:offset + 16]
        offset += 16
        key = _derive_key(password, salt)
        try:
            zip_bytes = Fernet(key).decrypt(file_bytes[offset:])
        except InvalidToken:
            raise BackupError("Incorrect password, or the backup file is corrupted.")
    else:
        zip_bytes = file_bytes[offset:]

    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
        manifest = json.loads(zf.read("manifest.json"))
        data = json.loads(zf.read("data.json"))
    except (zipfile.BadZipFile, KeyError, json.JSONDecodeError):
        raise BackupError("This backup file is corrupted or unreadable.")

    current_revision = _current_schema_revision()
    if manifest.get("schema_revision") != current_revision:
        raise BackupError(
            "This backup was created with a different app version than this install "
            "and can't be safely restored. Restore onto an install running the same "
            "version the backup was made with."
        )

    table_to_model = _table_to_model_map()
    ordered_tables = [t for t in db.metadata.sorted_tables if t.name in table_to_model]

    try:
        if ordered_tables:
            quoted = ", ".join(f'"{t.name}"' for t in ordered_tables)
            db.session.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))

        for table in ordered_tables:
            model = table_to_model[table.name]
            secret_fields = _SECRET_FIELDS.get(table.name, [])
            skip_cols = {col for col, _ in secret_fields}
            datetime_cols = {c.name for c in table.columns if isinstance(c.type, db.DateTime)}

            for row in data.get(table.name, []):
                kwargs = {}
                for col in table.columns:
                    if col.name in skip_cols:
                        continue
                    val = row.get(col.name)
                    if val is not None and col.name in datetime_cols:
                        val = datetime.fromisoformat(val)
                    kwargs[col.name] = val
                obj = model(**kwargs)
                for col_name, prop_name in secret_fields:
                    plain = row.get(f"{prop_name}_plain")
                    if plain:
                        setattr(obj, prop_name, plain)
                db.session.add(obj)
            db.session.flush()

        for table in ordered_tables:
            pk_cols = list(table.primary_key.columns)
            if len(pk_cols) != 1 or not isinstance(pk_cols[0].type, db.Integer):
                continue
            pk_name = pk_cols[0].name
            db.session.execute(text(
                f"SELECT setval(pg_get_serial_sequence('\"{table.name}\"', '{pk_name}'), "
                f'COALESCE((SELECT MAX("{pk_name}") FROM "{table.name}"), 1))'
            ))

        upload_root = os.path.realpath(_upload_root())
        os.makedirs(upload_root, exist_ok=True)
        # Clear existing contents without removing upload_root itself - it's
        # a volume mount point, so rmtree()-ing the directory itself raises
        # EBUSY ("Device or resource busy").
        for entry in os.scandir(upload_root):
            if entry.is_dir(follow_symlinks=False):
                shutil.rmtree(entry.path)
            else:
                os.unlink(entry.path)

        for name in zf.namelist():
            if not name.startswith("uploads/") or name.endswith("/"):
                continue
            rel = name[len("uploads/"):]
            dest = os.path.realpath(os.path.join(upload_root, rel))
            if dest != upload_root and not dest.startswith(upload_root + os.sep):
                continue  # zip-slip attempt - skip
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with zf.open(name) as src, open(dest, "wb") as out:
                shutil.copyfileobj(src, out)

        db.session.commit()
    except BackupError:
        db.session.rollback()
        raise
    except Exception as e:
        db.session.rollback()
        raise BackupError(f"Restore failed: {e}")
