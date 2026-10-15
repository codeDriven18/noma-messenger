"""Web Push (VAPID): system notifications for users without an open socket."""

import asyncio
import json
import logging
import re
from typing import Coroutine, Iterable

from cryptography.hazmat.primitives.serialization import load_pem_private_key
from py_vapid import Vapid
from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import VAPID_PRIVATE_PEM, VAPID_SUBJECT
from .database import SessionLocal
from .models import Chat, ChatMember, Message, PushSubscription, User
from .ws_manager import manager

log = logging.getLogger("noma.push")

_vapid = Vapid(load_pem_private_key(VAPID_PRIVATE_PEM, password=None))
_tasks: set[asyncio.Task] = set()

DEFAULT_ICON = "/icons/icon-192.png"
MESSAGE_TTL = 24 * 3600

_KIND_LABEL = {
    "photo": "🖼 Фото",
    "video": "🎬 Видео",
    "file": "📎 Файл",
    "voice": "🎤 Голосовое сообщение",
    "video_note": "⭕ Видеосообщение",
    "audio": "🎵 Аудио",
}
_SPOILER = re.compile(r"\|\|.+?\|\|", re.S)
_MARKUP = re.compile(r"(\*\*|__|~~|```|`)")


def deliver(subscription: dict, data: str, ttl: int) -> int | None:
    """Blocking send through the browser's push service; returns the HTTP status on failure."""
    try:
        webpush(
            subscription,
            data,
            vapid_private_key=_vapid,
            vapid_claims={"sub": VAPID_SUBJECT},
            ttl=ttl,
            timeout=10,
            headers={"Urgency": "high"},
        )
    except WebPushException as exc:
        log.info("push to %s failed: %s", subscription["endpoint"][:60], exc.message)
        return exc.status_code or 0
    except Exception:
        log.warning("push to %s failed", subscription["endpoint"][:60], exc_info=True)
        return 0
    return None


async def send_to_users(user_ids: Iterable[int], payload: dict, ttl: int = MESSAGE_TTL) -> int:
    """Push `payload` to every device of `user_ids`; drops subscriptions the push service has expired."""
    ids = list(set(user_ids))
    if not ids:
        return 0
    async with SessionLocal() as db:
        subs = (await db.execute(select(PushSubscription).where(PushSubscription.user_id.in_(ids)))).scalars().all()
    if not subs:
        return 0
    data = json.dumps(payload, ensure_ascii=False)
    results = await asyncio.gather(
        *(
            asyncio.to_thread(deliver, {"endpoint": s.endpoint, "keys": {"p256dh": s.p256dh, "auth": s.auth}}, data, ttl)
            for s in subs
        )
    )
    gone = [s.id for s, status in zip(subs, results) if status in (404, 410)]
    if gone:
        async with SessionLocal() as db:
            await db.execute(delete(PushSubscription).where(PushSubscription.id.in_(gone)))
            await db.commit()
    return len(subs) - results.count(None)


def spawn(coro: Coroutine) -> None:
    """Fire-and-forget so the request that triggered the push is not held up by push services."""
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def drain() -> None:
    """Wait for queued pushes (tests and graceful shutdown)."""
    while _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


def preview(msg: Message) -> str:
    text = _MARKUP.sub("", _SPOILER.sub("▒▒▒▒", msg.text or ""))
    text = " ".join(text.split())
    if msg.attachments:
        first = msg.attachments[0]
        kind = first.get("kind")
        if len(msg.attachments) > 1 and kind in ("photo", "video"):
            label = f"🖼 Альбом · {len(msg.attachments)}"
        elif kind in ("file", "audio"):
            label = f"📎 {first.get('name') or 'Файл'}"
        else:
            label = _KIND_LABEL.get(kind, "Вложение")
        text = f"{label.split(' ')[0]} {text}" if text else label
    if msg.forward_info:
        text = f"↪ {text}"
    return text[:240] or "Новое сообщение"


async def offline_recipients(db: AsyncSession, chat_id: int, sender_id: int) -> list[int]:
    """Members who should get a push: not the sender, chat not muted, no open socket."""
    rows = await db.execute(select(ChatMember.user_id, ChatMember.muted).where(ChatMember.chat_id == chat_id))
    return [uid for uid, muted in rows if uid != sender_id and not muted and not manager.is_online(uid)]


async def notify_messages(db: AsyncSession, chat: Chat, messages: list[Message], sender: User) -> None:
    """Queue a push about new `messages` (one send or forward batch) for offline, non-muted members."""
    if chat.type == "saved" or not messages:
        return
    targets = await offline_recipients(db, chat.id, sender.id)
    if not targets:
        return
    if len(messages) == 1:
        body = preview(messages[0])
    else:
        forwarded = sum(1 for m in messages if m.forward_info)
        body = f"↪ Пересланные сообщения · {forwarded}"
        comment = next((m for m in messages if not m.forward_info), None)
        if comment:
            body = f"{preview(comment)}\n{body}"
    if chat.type == "private":
        title, icon = sender.display_name, sender.avatar_url
    else:
        title, icon = chat.title, chat.avatar_url
        if chat.type == "group":
            body = f"{sender.display_name}: {body}"
    payload = {
        "type": "message",
        "chat_id": chat.id,
        "message_id": messages[-1].id,
        "title": title,
        "body": body,
        "icon": icon or DEFAULT_ICON,
        "tag": f"chat-{chat.id}",
    }
    spawn(send_to_users(targets, payload))


def notify_call(
    callee_id: int, caller: User, chat_id: int, call_id: str, video: bool, missed: bool = False, ttl: int = MESSAGE_TTL
) -> None:
    """Incoming call (or the missed call that replaces it) for a callee without an open socket."""
    if manager.is_online(callee_id):
        return
    kind = "видеозвонок" if video else "звонок"
    payload = {
        "type": "call.missed" if missed else "call",
        "chat_id": chat_id,
        "call_id": call_id,
        "title": caller.display_name,
        "body": f"📞 Пропущенный {kind}" if missed else f"Входящий {kind}",
        "icon": caller.avatar_url or DEFAULT_ICON,
        "tag": f"call-{call_id}",
    }
    spawn(send_to_users([callee_id], payload, ttl=ttl))
