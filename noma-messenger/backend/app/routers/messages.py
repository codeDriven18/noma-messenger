from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Chat, ChatMember, Message, Reaction, User
from ..push import notify_messages
from ..schemas import DeleteMessagesIn, EditMessageIn, ForwardIn, ReactionIn, SendMessageIn
from ..security import get_current_user
from ..services import (
    ADMIN_ROLES,
    can_post,
    member_ids,
    reactions_for,
    require_chat_member,
    serialize_message,
    serialize_messages,
    users_by_ids,
)
from ..utils import utcnow
from ..ws_manager import manager

router = APIRouter(prefix="/api", tags=["messages"])


async def _readable_chat(db: AsyncSession, chat_id: int, user_id: int) -> Chat:
    chat = await db.get(Chat, chat_id)
    if chat is None:
        raise HTTPException(404, "Чат не найден")
    if await db.get(ChatMember, (chat_id, user_id)) is None and not chat.is_public:
        raise HTTPException(403, "Нет доступа")
    return chat


@router.get("/chats/{chat_id}/messages")
async def list_messages(
    chat_id: int,
    before: int | None = None,
    since_id: int | None = None,
    after: int | None = None,
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _readable_chat(db, chat_id, user.id)
    q = select(Message).where(Message.chat_id == chat_id)
    if before:
        q = q.where(Message.id < before)
    if after:
        rows = (await db.execute(q.where(Message.id > after).order_by(Message.id).limit(500))).scalars().all()
        return {"messages": await serialize_messages(db, rows), "has_more": None}
    if since_id:
        rows = (await db.execute(q.where(Message.id >= since_id).order_by(Message.id).limit(3000))).scalars().all()
        has_more = (
            await db.execute(select(Message.id).where(Message.chat_id == chat_id, Message.id < since_id).limit(1))
        ).first() is not None
        return {"messages": await serialize_messages(db, rows), "has_more": has_more}
    rows = (await db.execute(q.order_by(Message.id.desc()).limit(limit + 1))).scalars().all()
    has_more = len(rows) > limit
    rows = list(reversed(rows[:limit]))
    return {"messages": await serialize_messages(db, rows), "has_more": has_more}


@router.get("/chats/{chat_id}/search")
async def search_messages(
    chat_id: int,
    q: str = Query(..., min_length=1, max_length=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _readable_chat(db, chat_id, user.id)
    rows = (
        await db.execute(
            select(Message)
            .where(Message.chat_id == chat_id, Message.type == "text", func.lower(Message.text).like(f"%{q.lower()}%"))
            .order_by(Message.id.desc())
            .limit(100)
        )
    ).scalars().all()
    return await serialize_messages(db, rows)


@router.post("/chats/{chat_id}/messages")
async def send_message(
    chat_id: int, body: SendMessageIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    chat, member = await require_chat_member(db, chat_id, user.id)
    if not can_post(chat, member):
        raise HTTPException(403, "В этом канале могут писать только администраторы")
    text = body.text.strip()
    if not text and not body.attachments:
        raise HTTPException(422, "Пустое сообщение")
    if body.client_id:
        dup = (
            await db.execute(select(Message).where(Message.chat_id == chat_id, Message.client_id == body.client_id))
        ).scalar_one_or_none()
        if dup:
            return await serialize_message(db, dup)
    reply_to = None
    if body.reply_to_id:
        target = await db.get(Message, body.reply_to_id)
        reply_to = target.id if target and target.chat_id == chat_id else None
    msg = Message(
        chat_id=chat_id,
        sender_id=user.id,
        type="text",
        text=text,
        attachments=[a.model_dump(exclude_none=True) for a in body.attachments] or None,
        reply_to_id=reply_to,
        client_id=body.client_id,
        created_at=utcnow(),
    )
    db.add(msg)
    await db.flush()
    member.last_read_id = msg.id
    if member.archived:
        member.archived = False
    await db.commit()
    payload = await serialize_message(db, msg)
    recipients = await member_ids(db, chat_id)
    await manager.send_to_users(recipients, {"type": "message.new", "message": payload})
    await notify_messages(db, chat, [msg], user)
    return payload


@router.patch("/messages/{message_id}")
async def edit_message(
    message_id: int, body: EditMessageIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    msg = await db.get(Message, message_id)
    if msg is None:
        raise HTTPException(404, "Сообщение не найдено")
    if msg.sender_id != user.id or msg.type != "text":
        raise HTTPException(403, "Можно редактировать только свои сообщения")
    text = body.text.strip()
    if not text and not msg.attachments:
        raise HTTPException(422, "Пустое сообщение")
    msg.text = text
    msg.edited_at = utcnow()
    await db.commit()
    payload = await serialize_message(db, msg)
    await manager.send_to_users(await member_ids(db, msg.chat_id), {"type": "message.edit", "message": payload})
    return payload


@router.post("/messages/delete")
async def delete_messages(
    body: DeleteMessagesIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    msgs = (await db.execute(select(Message).where(Message.id.in_(body.message_ids)))).scalars().all()
    if not msgs:
        return {"deleted": []}
    chat_ids = {m.chat_id for m in msgs}
    if len(chat_ids) != 1:
        raise HTTPException(400, "Сообщения из разных чатов")
    chat, member = await require_chat_member(db, chat_ids.pop(), user.id)
    is_admin = member.role in ADMIN_ROLES and chat.type in ("group", "channel")
    for m in msgs:
        if not (m.sender_id == user.id or is_admin or chat.type in ("private", "saved")):
            raise HTTPException(403, "Нельзя удалить чужое сообщение")
    ids = [m.id for m in msgs]
    await db.execute(delete(Reaction).where(Reaction.message_id.in_(ids)))
    await db.execute(delete(Message).where(Message.id.in_(ids)))
    if chat.pinned_message_id in ids:
        chat.pinned_message_id = None
    await db.commit()
    last = (
        await db.execute(select(Message).where(Message.chat_id == chat.id).order_by(Message.id.desc()).limit(1))
    ).scalar_one_or_none()
    event = {
        "type": "message.delete",
        "chat_id": chat.id,
        "message_ids": ids,
        "last_message": await serialize_message(db, last) if last else None,
        "pinned_cleared": chat.pinned_message_id is None,
    }
    await manager.send_to_users(await member_ids(db, chat.id), event)
    return {"deleted": ids}


@router.post("/messages/{message_id}/reactions")
async def react(
    message_id: int, body: ReactionIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    msg = await db.get(Message, message_id)
    if msg is None:
        raise HTTPException(404, "Сообщение не найдено")
    await require_chat_member(db, msg.chat_id, user.id)
    existing = await db.get(Reaction, (message_id, user.id))
    if existing and existing.emoji == body.emoji:
        await db.delete(existing)
    elif existing:
        existing.emoji = body.emoji
        existing.created_at = utcnow()
    else:
        db.add(Reaction(message_id=message_id, user_id=user.id, emoji=body.emoji, created_at=utcnow()))
    await db.commit()
    reactions = (await reactions_for(db, [message_id])).get(message_id, [])
    event = {"type": "message.reactions", "chat_id": msg.chat_id, "message_id": message_id, "reactions": reactions,
             "actor_id": user.id, "emoji": body.emoji, "sender_id": msg.sender_id}
    await manager.send_to_users(await member_ids(db, msg.chat_id), event)
    return {"reactions": reactions}


@router.post("/messages/forward")
async def forward(body: ForwardIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    source = (
        await db.execute(select(Message).where(Message.id.in_(body.message_ids), Message.type == "text").order_by(Message.id))
    ).scalars().all()
    if not source:
        raise HTTPException(404, "Нечего пересылать")
    allowed_sources = set()
    for cid in {m.chat_id for m in source}:
        await _readable_chat(db, cid, user.id)
        allowed_sources.add(cid)
    senders = {u["id"]: u for u in await users_by_ids(db, [m.sender_id for m in source])}
    source_chats = {
        c.id: c for c in (await db.execute(select(Chat).where(Chat.id.in_(allowed_sources)))).scalars().all()
    }
    created: list[Message] = []
    batches: list[tuple[Chat, list[Message]]] = []
    for target_id in dict.fromkeys(body.chat_ids):
        chat, member = await require_chat_member(db, target_id, user.id)
        if not can_post(chat, member):
            continue
        now = utcnow()
        batch: list[Message] = []
        if body.comment.strip():
            batch.append(Message(chat_id=target_id, sender_id=user.id, type="text", text=body.comment.strip(), created_at=now))
        for m in source:
            info = m.forward_info
            if not info:
                src_chat = source_chats.get(m.chat_id)
                if src_chat and src_chat.type == "channel":
                    info = {"user_id": None, "name": src_chat.title, "chat_id": src_chat.id}
                else:
                    sender = senders.get(m.sender_id)
                    info = {"user_id": m.sender_id, "name": sender["display_name"] if sender else "Пользователь"}
            batch.append(
                Message(chat_id=target_id, sender_id=user.id, type="text", text=m.text, attachments=m.attachments,
                        forward_info=info, created_at=now)
            )
        db.add_all(batch)
        await db.flush()
        member.last_read_id = max(member.last_read_id, batch[-1].id)
        created.extend(batch)
        batches.append((chat, batch))
    await db.commit()
    for msg in created:
        payload = await serialize_message(db, msg)
        await manager.send_to_users(await member_ids(db, msg.chat_id), {"type": "message.new", "message": payload})
    for chat, batch in batches:
        await notify_messages(db, chat, batch, user)
    return {"count": len(created)}


@router.get("/calls")
async def call_history(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    my_chats = select(ChatMember.chat_id).where(ChatMember.user_id == user.id)
    rows = (
        await db.execute(
            select(Message).where(Message.type == "call", Message.chat_id.in_(my_chats)).order_by(Message.id.desc()).limit(150)
        )
    ).scalars().all()
    payload = await serialize_messages(db, rows)
    peers = (
        await db.execute(
            select(ChatMember.chat_id, ChatMember.user_id).where(
                ChatMember.chat_id.in_({m.chat_id for m in rows}), ChatMember.user_id != user.id
            )
        )
    ).all()
    peer_by_chat = {cid: uid for cid, uid in peers}
    users = await users_by_ids(db, peer_by_chat.values())
    return {"calls": [{**p, "peer_id": peer_by_chat.get(p["chat_id"])} for p in payload], "users": users}
