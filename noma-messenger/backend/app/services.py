"""Serialization and realtime fan-out helpers shared by the routers and the socket."""

from collections import defaultdict
from typing import Iterable, Sequence

from fastapi import HTTPException
from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Chat, ChatMember, Message, Reaction, User
from .utils import iso, utcnow
from .ws_manager import manager

ADMIN_ROLES = ("owner", "admin")


# ---------------------------------------------------------------- users

def user_public(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "bio": user.bio or "",
        "avatar_url": user.avatar_url,
        "color": user.color,
        "is_bot": user.is_bot,
        "online": manager.is_online(user.id),
        "last_seen": iso(user.last_seen),
    }


async def users_by_ids(db: AsyncSession, ids: Iterable[int]) -> list[dict]:
    ids = list(set(ids))
    if not ids:
        return []
    rows = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    return [user_public(u) for u in rows]


# ---------------------------------------------------------------- messages

def _attachment_kind(msg: Message) -> str | None:
    if msg.attachments:
        return msg.attachments[0].get("kind")
    return None


def reply_preview(msg: Message | None, reply_id: int) -> dict:
    if msg is None:
        return {"id": reply_id, "sender_id": None, "text": "", "kind": None, "thumb": None, "deleted": True}
    first = (msg.attachments or [None])[0] or {}
    thumb = first.get("url") if first.get("kind") == "photo" else first.get("thumb")
    return {
        "id": msg.id,
        "sender_id": msg.sender_id,
        "text": (msg.text or "")[:160],
        "kind": _attachment_kind(msg),
        "thumb": thumb,
        "deleted": False,
    }


async def reactions_for(db: AsyncSession, message_ids: Sequence[int]) -> dict[int, list[dict]]:
    out: dict[int, list[dict]] = defaultdict(list)
    if not message_ids:
        return out
    rows = (
        await db.execute(
            select(Reaction)
            .where(Reaction.message_id.in_(message_ids))
            .order_by(Reaction.created_at)
        )
    ).scalars().all()
    grouped: dict[int, dict[str, list[int]]] = defaultdict(dict)
    for r in rows:
        grouped[r.message_id].setdefault(r.emoji, []).append(r.user_id)
    for mid, emojis in grouped.items():
        out[mid] = [{"emoji": e, "count": len(u), "user_ids": u} for e, u in emojis.items()]
    return out


async def serialize_messages(db: AsyncSession, messages: Sequence[Message]) -> list[dict]:
    if not messages:
        return []
    ids = [m.id for m in messages]
    reacts = await reactions_for(db, ids)
    reply_ids = {m.reply_to_id for m in messages if m.reply_to_id}
    replies: dict[int, Message] = {}
    if reply_ids:
        rows = (await db.execute(select(Message).where(Message.id.in_(reply_ids)))).scalars().all()
        replies = {m.id: m for m in rows}
    result = []
    for m in messages:
        result.append(
            {
                "id": m.id,
                "chat_id": m.chat_id,
                "sender_id": m.sender_id,
                "type": m.type,
                "text": m.text or "",
                "attachments": m.attachments or [],
                "reply_to": reply_preview(replies.get(m.reply_to_id), m.reply_to_id)
                if m.reply_to_id
                else None,
                "forward": m.forward_info,
                "call": m.call_info,
                "reactions": reacts.get(m.id, []),
                "edited_at": iso(m.edited_at),
                "created_at": iso(m.created_at),
                "client_id": m.client_id,
            }
        )
    return result


async def serialize_message(db: AsyncSession, message: Message) -> dict:
    return (await serialize_messages(db, [message]))[0]


# ---------------------------------------------------------------- chats

async def member_ids(db: AsyncSession, chat_id: int) -> list[int]:
    rows = await db.execute(select(ChatMember.user_id).where(ChatMember.chat_id == chat_id))
    return [r[0] for r in rows]


async def get_member(db: AsyncSession, chat_id: int, user_id: int) -> ChatMember | None:
    return await db.get(ChatMember, (chat_id, user_id))


async def require_chat_member(db: AsyncSession, chat_id: int, user_id: int) -> tuple[Chat, ChatMember]:
    chat = await db.get(Chat, chat_id)
    if chat is None:
        raise HTTPException(404, "Чат не найден")
    member = await get_member(db, chat_id, user_id)
    if member is None:
        raise HTTPException(403, "Вы не участник этого чата")
    return chat, member


def can_post(chat: Chat, member: ChatMember) -> bool:
    if chat.type == "channel":
        return member.role in ADMIN_ROLES
    return True


async def chat_payloads(
    db: AsyncSession, user_id: int, chat_ids: Iterable[int] | None = None
) -> tuple[list[dict], list[int]]:
    """Personalised chat list entries for `user_id` plus every related user id."""
    q = select(Chat, ChatMember).join(
        ChatMember, and_(ChatMember.chat_id == Chat.id, ChatMember.user_id == user_id)
    )
    if chat_ids is not None:
        chat_ids = list(chat_ids)
        if not chat_ids:
            return [], []
        q = q.where(Chat.id.in_(chat_ids))
    rows = (await db.execute(q)).all()
    if not rows:
        return [], []
    ids = [c.id for c, _ in rows]

    members: dict[int, list[tuple[int, str, int]]] = defaultdict(list)
    for chat_id, uid, role, last_read in (
        await db.execute(
            select(ChatMember.chat_id, ChatMember.user_id, ChatMember.role, ChatMember.last_read_id).where(
                ChatMember.chat_id.in_(ids)
            )
        )
    ).all():
        members[chat_id].append((uid, role, last_read))

    last_ids = select(func.max(Message.id)).where(Message.chat_id.in_(ids)).group_by(Message.chat_id)
    last_msgs = (await db.execute(select(Message).where(Message.id.in_(last_ids)))).scalars().all()

    pinned_ids = [c.pinned_message_id for c, _ in rows if c.pinned_message_id]
    pinned_msgs = (
        (await db.execute(select(Message).where(Message.id.in_(pinned_ids)))).scalars().all()
        if pinned_ids
        else []
    )
    serialized = {m["id"]: m for m in await serialize_messages(db, [*last_msgs, *pinned_msgs])}
    last_by_chat = {m.chat_id: serialized[m.id] for m in last_msgs}

    me = ChatMember.__table__.alias("me")
    unread_rows = (
        await db.execute(
            select(Message.chat_id, func.count(Message.id))
            .join(me, and_(me.c.chat_id == Message.chat_id, me.c.user_id == user_id))
            .where(Message.chat_id.in_(ids), Message.id > me.c.last_read_id, Message.sender_id != user_id)
            .group_by(Message.chat_id)
        )
    ).all()
    unread = dict(unread_rows)

    related: set[int] = set()
    out = []
    for chat, mine in rows:
        mlist = members[chat.id]
        others = [m for m in mlist if m[0] != user_id]
        # Channels can be huge: ship member ids only to admins / small rooms.
        ship_members = chat.type != "channel" or len(mlist) <= 200
        mids = [m[0] for m in mlist] if ship_members else [user_id]
        if chat.type in ("private", "group", "saved") or ship_members:
            related.update(mids)
        last = last_by_chat.get(chat.id)
        if last:
            related.add(last["sender_id"])
        out.append(
            {
                "id": chat.id,
                "type": chat.type,
                "title": chat.title,
                "description": chat.description,
                "avatar_url": chat.avatar_url,
                "color": chat.color,
                "username": chat.username,
                "is_public": chat.is_public,
                "created_by": chat.created_by,
                "created_at": iso(chat.created_at),
                "member_ids": mids,
                "member_count": len(mlist),
                "roles": {str(uid): role for uid, role, _ in mlist if role != "member"},
                "my_role": mine.role,
                "pinned": mine.pinned,
                "muted": mine.muted,
                "archived": mine.archived,
                "last_read_id": mine.last_read_id,
                "peer_read_id": max((m[2] for m in others), default=mine.last_read_id if chat.type == "saved" else 0),
                "unread_count": unread.get(chat.id, 0),
                "last_message": last,
                "pinned_message": serialized.get(chat.pinned_message_id) if chat.pinned_message_id else None,
            }
        )
    return out, list(related)


async def chat_payload(db: AsyncSession, user_id: int, chat_id: int) -> dict | None:
    chats, _ = await chat_payloads(db, user_id, [chat_id])
    return chats[0] if chats else None


async def push_chat(db: AsyncSession, chat_id: int, user_ids: Iterable[int], event: str = "chat.update") -> None:
    """Send each user their personalised version of the chat (plus related users)."""
    for uid in set(user_ids):
        if not manager.is_online(uid):
            continue
        chats, related = await chat_payloads(db, uid, [chat_id])
        if chats:
            await manager.send_to_user(
                uid, {"type": event, "chat": chats[0], "users": await users_by_ids(db, related)}
            )


async def broadcast_message(db: AsyncSession, msg: Message, event: str = "message.new") -> dict:
    payload = await serialize_message(db, msg)
    await manager.send_to_users(await member_ids(db, msg.chat_id), {"type": event, "message": payload})
    return payload


async def create_system_message(db: AsyncSession, chat_id: int, actor_id: int, text: str) -> Message:
    msg = Message(chat_id=chat_id, sender_id=actor_id, type="system", text=text, created_at=utcnow())
    db.add(msg)
    await db.flush()
    actor = await db.get(ChatMember, (chat_id, actor_id))
    if actor:
        actor.last_read_id = max(actor.last_read_id, msg.id)
    return msg


async def delete_chat_completely(db: AsyncSession, chat: Chat) -> list[int]:
    uids = await member_ids(db, chat.id)
    msg_ids = select(Message.id).where(Message.chat_id == chat.id)
    await db.execute(delete(Reaction).where(Reaction.message_id.in_(msg_ids)))
    await db.execute(delete(Message).where(Message.chat_id == chat.id))
    await db.execute(delete(ChatMember).where(ChatMember.chat_id == chat.id))
    await db.delete(chat)
    return uids


async def contact_ids(db: AsyncSession, user_id: int) -> list[int]:
    """Users who share a private chat or a group with `user_id` (presence audience)."""
    me = ChatMember.__table__.alias("me")
    rows = await db.execute(
        select(ChatMember.user_id)
        .join(me, me.c.chat_id == ChatMember.chat_id)
        .join(Chat, Chat.id == ChatMember.chat_id)
        .where(me.c.user_id == user_id, ChatMember.user_id != user_id, Chat.type.in_(("private", "group")))
        .distinct()
    )
    return [r[0] for r in rows]
