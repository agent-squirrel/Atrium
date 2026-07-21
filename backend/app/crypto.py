from flask import current_app
from cryptography.fernet import Fernet
import base64


def get_fernet() -> Fernet:
    key = current_app.config.get("ENCRYPTION_KEY", "")
    if not key:
        # Derive a key from SECRET_KEY so dev works without explicit ENCRYPTION_KEY
        import hashlib
        raw = hashlib.sha256(current_app.config["SECRET_KEY"].encode()).digest()
        key = base64.urlsafe_b64encode(raw).decode()
    return Fernet(key.encode() if isinstance(key, str) else key)
