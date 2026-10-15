import base64
import json
import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("NOMA_DATA_DIR", BASE_DIR / "data"))
MEDIA_DIR = DATA_DIR / "media"
DATA_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv(
    "NOMA_DATABASE_URL", f"sqlite+aiosqlite:///{(DATA_DIR / 'noma.db').as_posix()}"
)


def _load_secret() -> str:
    env = os.getenv("NOMA_SECRET_KEY")
    if env:
        return env
    path = DATA_DIR / "secret.key"
    if path.exists():
        return path.read_text().strip()
    key = secrets.token_urlsafe(48)
    path.write_text(key)
    return key


SECRET_KEY = _load_secret()


def _load_vapid() -> tuple[bytes, str]:
    """Web Push VAPID key pair: (private key PEM, public key as base64url uncompressed point)."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    env = os.getenv("NOMA_VAPID_PRIVATE_KEY")
    path = DATA_DIR / "vapid_private.pem"
    if env:
        pem = env.replace("\\n", "\n").encode()
    elif path.exists():
        pem = path.read_bytes()
    else:
        pem = ec.generate_private_key(ec.SECP256R1()).private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
        path.write_bytes(pem)
    key = serialization.load_pem_private_key(pem, password=None)
    point = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return pem, base64.urlsafe_b64encode(point).rstrip(b"=").decode()


VAPID_PRIVATE_PEM, VAPID_PUBLIC_KEY = _load_vapid()
# Contact for push services (RFC 8292): mailto: or https: URL of whoever runs this server.
VAPID_SUBJECT = os.getenv("NOMA_VAPID_SUBJECT", "mailto:admin@example.com")

TOKEN_TTL_DAYS = int(os.getenv("NOMA_TOKEN_TTL_DAYS", "30"))
MAX_UPLOAD_MB = int(os.getenv("NOMA_MAX_UPLOAD_MB", "512"))

# WebRTC ICE servers. For calls between different networks add a TURN server, e.g.
# NOMA_ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]'
ICE_SERVERS = json.loads(
    os.getenv(
        "NOMA_ICE_SERVERS",
        '[{"urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}]',
    )
)

FRONTEND_DIST = Path(os.getenv("NOMA_FRONTEND_DIST", BASE_DIR.parent / "frontend" / "dist"))
