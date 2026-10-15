import mimetypes
import uuid
from pathlib import Path

import anyio
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..config import ICE_SERVERS, MAX_UPLOAD_MB, MEDIA_DIR
from ..models import User
from ..security import get_current_user
from ..utils import utcnow

router = APIRouter(prefix="/api", tags=["media"])

CHUNK = 1024 * 1024
SAFE_EXT = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".heic", ".bmp", ".svg",
    ".mp4", ".webm", ".mov", ".mkv", ".m4v",
    ".mp3", ".ogg", ".oga", ".opus", ".wav", ".m4a", ".aac", ".flac",
}


@router.post("/upload")
async def upload(file: UploadFile = File(...), _: User = Depends(get_current_user)):
    original = Path(file.filename or "file").name
    ext = Path(original).suffix.lower()[:10]
    if not ext:
        ext = mimetypes.guess_extension(file.content_type or "") or ""
    # Unknown extensions are stored as .bin so the static server never serves them as html/js.
    stored_ext = ext if ext in SAFE_EXT else ".bin"
    if ext == ".svg":
        stored_ext = ".bin"
    now = utcnow()
    folder = MEDIA_DIR / f"{now:%Y}" / f"{now:%m}"
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{stored_ext}"
    target = folder / name
    size = 0
    limit = MAX_UPLOAD_MB * 1024 * 1024
    try:
        async with await anyio.open_file(target, "wb") as out:
            while chunk := await file.read(CHUNK):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"Файл больше {MAX_UPLOAD_MB} МБ")
                await out.write(chunk)
    except HTTPException:
        target.unlink(missing_ok=True)
        raise
    return {
        "url": f"/media/{now:%Y}/{now:%m}/{name}",
        "name": original[:255],
        "size": size,
        "mime": file.content_type or mimetypes.guess_type(original)[0] or "application/octet-stream",
    }


@router.get("/config")
async def client_config():
    return {"ice_servers": ICE_SERVERS, "max_upload_mb": MAX_UPLOAD_MB}
