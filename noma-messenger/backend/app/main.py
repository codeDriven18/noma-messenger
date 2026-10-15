import logging
import mimetypes
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import FRONTEND_DIST, MEDIA_DIR
from .database import SessionLocal, init_db
from .onboarding import ensure_bot
from .push import drain as drain_push
from .routers import auth, chats, media, messages, push, users, ws

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# Windows registry can map these wrongly; service workers and manifests need exact types.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/manifest+json", ".webmanifest")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    async with SessionLocal() as db:
        await ensure_bot(db)
    yield
    await drain_push()


app = FastAPI(title="NOMA Messenger", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth.router, users.router, chats.router, messages.router, media.router, push.router, ws.router):
    app.include_router(r)


@app.get("/api/health")
async def health():
    return {"ok": True}


class MediaFiles(StaticFiles):
    """User uploads: long cache, never sniffed as active content."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        response.headers["X-Content-Type-Options"] = "nosniff"
        if path.endswith(".bin"):
            response.headers["Content-Disposition"] = "attachment"
        return response


app.mount("/media", MediaFiles(directory=MEDIA_DIR), name="media")


# Serve the built frontend (npm run build) so a single process runs the whole app.
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith(("api/", "ws", "media/")):
            raise HTTPException(404)
        candidate = (FRONTEND_DIST / path).resolve()
        if path and candidate.is_file() and FRONTEND_DIST.resolve() in candidate.parents:
            # The service worker must always be revalidated, or app updates never reach installed clients.
            headers = {"Cache-Control": "no-cache"} if path == "sw.js" else None
            return FileResponse(candidate, headers=headers)
        return FileResponse(FRONTEND_DIST / "index.html", headers={"Cache-Control": "no-cache"})
