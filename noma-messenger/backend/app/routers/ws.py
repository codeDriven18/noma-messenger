"""Realtime socket: presence, typing indicators and WebRTC call signalling."""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..database import SessionLocal
from ..models import Chat, ChatMember, Message, User
from ..push import notify_call
from ..security import decode_token
from ..services import broadcast_message, contact_ids, member_ids
from ..utils import iso, utcnow
from ..ws_manager import manager

log = logging.getLogger("noma.ws")
router = APIRouter()

RING_TIMEOUT = 45


@dataclass
class ActiveCall:
    id: str
    chat_id: int
    caller_id: int
    callee_id: int
    video: bool
    caller_ws: WebSocket
    callee_ws: WebSocket | None = None
    accepted_at: datetime | None = None
    created_at: datetime = field(default_factory=utcnow)
    timeout: asyncio.Task | None = None

    def peer_of(self, user_id: int) -> int:
        return self.callee_id if user_id == self.caller_id else self.caller_id


calls: dict[str, ActiveCall] = {}
user_calls: dict[int, str] = {}


async def _presence(user_id: int, online: bool) -> None:
    async with SessionLocal() as db:
        user = await db.get(User, user_id)
        if user is None:
            return
        user.last_seen = utcnow()
        await db.commit()
        audience = await contact_ids(db, user_id)
    await manager.send_to_users(
        audience, {"type": "presence", "user_id": user_id, "online": online, "last_seen": iso(user.last_seen)}
    )


async def _log_call(call: ActiveCall, status: str) -> None:
    duration = int((utcnow() - call.accepted_at).total_seconds()) if call.accepted_at else 0
    async with SessionLocal() as db:
        if await db.get(Chat, call.chat_id) is None:
            return
        msg = Message(
            chat_id=call.chat_id,
            sender_id=call.caller_id,
            type="call",
            text="",
            call_info={"video": call.video, "status": status, "duration": duration},
            created_at=utcnow(),
        )
        db.add(msg)
        await db.flush()
        caller = await db.get(ChatMember, (call.chat_id, call.caller_id))
        if caller:
            caller.last_read_id = max(caller.last_read_id, msg.id)
        if status == "ended":
            callee = await db.get(ChatMember, (call.chat_id, call.callee_id))
            if callee:
                callee.last_read_id = max(callee.last_read_id, msg.id)
        await db.commit()
        await broadcast_message(db, msg)


async def _finish(call: ActiveCall, status: str, reason: str, notify: list[int]) -> None:
    if calls.pop(call.id, None) is None:
        return
    if call.timeout and call.timeout is not asyncio.current_task():
        call.timeout.cancel()
    for uid in (call.caller_id, call.callee_id):
        if user_calls.get(uid) == call.id:
            user_calls.pop(uid, None)
    event = {"type": "call.ended", "call_id": call.id, "reason": reason}
    await manager.send_to_users(notify, event)
    if status == "missed":
        async with SessionLocal() as db:
            caller = await db.get(User, call.caller_id)
        if caller:
            notify_call(call.callee_id, caller, call.chat_id, call.id, call.video, missed=True)
    await _log_call(call, status)


async def _ring_timeout(call: ActiveCall) -> None:
    await asyncio.sleep(RING_TIMEOUT)
    if call.id in calls and call.accepted_at is None:
        await _finish(call, "missed", "timeout", [call.caller_id, call.callee_id])


def _incoming(call: ActiveCall) -> dict:
    return {"type": "call.incoming", "call_id": call.id, "chat_id": call.chat_id, "from_user_id": call.caller_id, "video": call.video}


async def _replay_ringing(user_id: int, ws: WebSocket) -> None:
    """A callee who opens the app from the push notification still gets to answer the call."""
    call = calls.get(user_calls.get(user_id, ""))
    if call is None or call.callee_id != user_id or call.accepted_at is not None:
        return
    await manager.send_ws(ws, _incoming(call))
    await manager.send_ws(call.caller_ws, {"type": "call.ringing", "call_id": call.id, "peer_online": True})


async def _handle_call(user_id: int, ws: WebSocket, data: dict) -> None:
    kind = data.get("type")
    call_id = str(data.get("call_id", ""))[:64]

    if kind == "call.invite":
        chat_id = int(data.get("chat_id", 0))
        async with SessionLocal() as db:
            chat = await db.get(Chat, chat_id)
            ids = await member_ids(db, chat_id) if chat else []
        if not chat or chat.type != "private" or user_id not in ids or len(ids) != 2:
            await manager.send_ws(ws, {"type": "call.ended", "call_id": call_id, "reason": "unavailable"})
            return
        peer_id = next(i for i in ids if i != user_id)
        async with SessionLocal() as db:
            peer = await db.get(User, peer_id)
            caller = await db.get(User, user_id)
        if peer is None or peer.is_bot:
            await manager.send_ws(ws, {"type": "call.ended", "call_id": call_id, "reason": "unavailable"})
            return
        call = ActiveCall(call_id, chat_id, user_id, peer_id, bool(data.get("video")), caller_ws=ws)
        if user_id in user_calls:
            await manager.send_ws(ws, {"type": "call.ended", "call_id": call_id, "reason": "already_in_call"})
            return
        if peer_id in user_calls:
            await manager.send_ws(ws, {"type": "call.ended", "call_id": call_id, "reason": "busy"})
            await _log_call(call, "busy")
            return
        calls[call_id] = call
        user_calls[user_id] = call_id
        user_calls[peer_id] = call_id
        call.timeout = asyncio.create_task(_ring_timeout(call))
        await manager.send_to_user(peer_id, _incoming(call))
        notify_call(peer_id, caller, chat_id, call_id, call.video, ttl=RING_TIMEOUT)
        await manager.send_ws(ws, {"type": "call.ringing", "call_id": call_id, "peer_online": manager.is_online(peer_id)})
        return

    call = calls.get(call_id)
    if call is None or user_id not in (call.caller_id, call.callee_id):
        if kind in ("call.accept", "call.signal"):
            await manager.send_ws(ws, {"type": "call.ended", "call_id": call_id, "reason": "gone"})
        return

    if kind == "call.accept" and user_id == call.callee_id and call.accepted_at is None:
        call.accepted_at = utcnow()
        call.callee_ws = ws
        if call.timeout:
            call.timeout.cancel()
        await manager.send_ws(call.caller_ws, {"type": "call.accepted", "call_id": call.id})
        await manager.send_to_user(
            call.callee_id, {"type": "call.ended", "call_id": call.id, "reason": "answered_elsewhere"}, exclude=ws
        )
    elif kind == "call.reject" and user_id == call.callee_id and call.accepted_at is None:
        await _finish(call, "declined", "declined", [call.caller_id, call.callee_id])
    elif kind == "call.signal":
        target_ws = call.callee_ws if user_id == call.caller_id else call.caller_ws
        if target_ws is not None:
            await manager.send_ws(target_ws, {"type": "call.signal", "call_id": call.id, "data": data.get("data")})
    elif kind == "call.end":
        if call.accepted_at:
            status = "ended"
        else:
            status = "missed" if user_id == call.caller_id else "declined"
        await _finish(call, status, "hangup", [call.caller_id, call.callee_id])


async def _handle_typing(user_id: int, data: dict) -> None:
    try:
        chat_id = int(data.get("chat_id", 0))
    except (TypeError, ValueError):
        return
    action = data.get("action", "typing")
    if action not in ("typing", "recording", "uploading", "video", "cancel"):
        return
    async with SessionLocal() as db:
        ids = await member_ids(db, chat_id)
        chat = await db.get(Chat, chat_id)
    if user_id not in ids or chat is None or chat.type == "channel":
        return
    await manager.send_to_users(
        [i for i in ids if i != user_id], {"type": "typing", "chat_id": chat_id, "user_id": user_id, "action": action}
    )


@router.websocket("/ws")
async def socket(ws: WebSocket, token: str = ""):
    user_id = decode_token(token)
    if user_id is None:
        await ws.close(code=4401)
        return
    async with SessionLocal() as db:
        if await db.get(User, user_id) is None:
            await ws.close(code=4401)
            return
    await ws.accept()
    if manager.connect(user_id, ws):
        await _presence(user_id, True)
    await manager.send_ws(ws, {"type": "hello", "user_id": user_id})
    await _replay_ringing(user_id, ws)
    try:
        while True:
            data = await ws.receive_json()
            if not isinstance(data, dict):
                continue
            kind = data.get("type", "")
            try:
                if kind == "ping":
                    await manager.send_ws(ws, {"type": "pong"})
                elif kind == "typing":
                    await _handle_typing(user_id, data)
                elif kind.startswith("call."):
                    await _handle_call(user_id, ws, data)
            except Exception:
                log.exception("failed to handle %s", kind)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.debug("socket closed", exc_info=True)
    finally:
        last = manager.disconnect(user_id, ws)
        # Shielded so a cancelled handler cannot abort the cleanup halfway through a DB write.
        await asyncio.shield(_cleanup(user_id, ws, last))


async def _cleanup(user_id: int, ws: WebSocket, last: bool) -> None:
    call_id = user_calls.get(user_id)
    call = calls.get(call_id) if call_id else None
    if call and (call.caller_ws is ws or call.callee_ws is ws or (last and call.accepted_at is None and user_id == call.caller_id)):
        status = "ended" if call.accepted_at else "missed"
        await _finish(call, status, "disconnected", [call.peer_of(user_id)])
    if last:
        await _presence(user_id, False)
