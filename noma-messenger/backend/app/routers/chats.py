import random

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Chat, ChatMember, Message, User
from ..schemas import (
    AddMembersIn,
    ChatSettingsIn,
    CreateGroupIn,
    PinIn,
    PrivateChatIn,
    ReadIn,
    RoleIn,
    UpdateChatIn,
)
from ..security import get_current_user
from ..services import (
    ADMIN_ROLES,
    chat_payload,
    chat_payloads,
    create_system_message,
    delete_chat_completely,
    member_ids,
    push_chat,
    require_chat_member,
    serialize_message,
    serialize_messages,
    users_by_ids,
)
from ..utils import iso, utcnow
from ..ws_manager import manager
from .auth import normalize_username

router = APIRouter(prefix="/api/chats", tags=["chats"])


def _noun(chat: Chat) -> str:
    return "канал" if chat.type == "channel" else "группу"


async def _check_chat_username(db: AsyncSession, raw: str | None, chat_id: int | None = None) -> str | None:
    if not raw:
        return None
    name = normalize_username(raw)
    q = select(Chat.id).where(Chat.username == name)
    if chat_id:
        q = q.where(Chat.id != chat_id)
    if (await db.execute(q)).first() or (await db.execute(select(User.id).where(User.username == name))).first():
        raise HTTPException(409, "Эта ссылка уже занята")
    return name


def _public_preview(chat: Chat, count: int) -> dict:
    return {
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
        "member_ids": [],
        "member_count": count,
        "roles": {},
        "my_role": None,
        "pinned": False,
        "muted": False,
        "archived": False,
        "last_read_id": 0,
        "peer_read_id": 0,
        "unread_count": 0,
        "last_message": None,
        "pinned_message": None,
    }


@router.get("")
async def list_chats(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    chats, related = await chat_payloads(db, user.id)
    return {"chats": chats, "users": await users_by_ids(db, [*related, user.id])}


@router.post("/private")
async def open_private(body: PrivateChatIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    peer = await db.get(User, body.user_id)
    if peer is None:
        raise HTTPException(404, "Пользователь не найден")
    a, b = sorted((user.id, peer.id))
    key = f"{a}:{b}"
    chat = (await db.execute(select(Chat).where(Chat.private_key == key))).scalar_one_or_none()
    if chat is None:
        chat = Chat(
            type="saved" if peer.id == user.id else "private",
            title="Избранное" if peer.id == user.id else "",
            private_key=key,
            created_by=user.id,
        )
        db.add(chat)
        await db.flush()
        db.add(ChatMember(chat_id=chat.id, user_id=user.id, role="owner" if peer.id == user.id else "member"))
        if peer.id != user.id:
            db.add(ChatMember(chat_id=chat.id, user_id=peer.id, role="member"))
        await db.commit()
    payload = await chat_payload(db, user.id, chat.id)
    return {"chat": payload, "users": await users_by_ids(db, [user.id, peer.id])}


@router.post("/group")
async def create_group(body: CreateGroupIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    username = await _check_chat_username(db, body.username) if body.is_public else None
    if body.is_public and not username:
        raise HTTPException(422, "Публичному чату нужна ссылка")
    if body.avatar_url and not body.avatar_url.startswith("/media/"):
        raise HTTPException(422, "Некорректный аватар")
    chat = Chat(
        type=body.type,
        title=body.title.strip(),
        description=body.description.strip(),
        avatar_url=body.avatar_url,
        color=random.randint(0, 7),
        username=username,
        is_public=body.is_public,
        created_by=user.id,
    )
    db.add(chat)
    await db.flush()
    db.add(ChatMember(chat_id=chat.id, user_id=user.id, role="owner"))
    ids = {i for i in body.member_ids if i != user.id}
    if ids:
        existing = (await db.execute(select(User.id).where(User.id.in_(ids), User.is_bot.is_(False)))).scalars().all()
        for uid in existing:
            db.add(ChatMember(chat_id=chat.id, user_id=uid, role="member"))
    await db.flush()
    verb = "создал(а) канал" if chat.type == "channel" else "создал(а) группу"
    await create_system_message(db, chat.id, user.id, f"{user.display_name} {verb} «{chat.title}»")
    await db.commit()
    await push_chat(db, chat.id, await member_ids(db, chat.id), "chat.new")
    payload, related = await chat_payloads(db, user.id, [chat.id])
    return {"chat": payload[0], "users": await users_by_ids(db, related)}


@router.get("/search")
async def search_public(q: str = Query("", max_length=64), user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    term = q.strip().lstrip("@").lower()
    if not term:
        return []
    rows = (
        await db.execute(
            select(Chat)
            .where(
                Chat.is_public.is_(True),
                or_(Chat.username.like(f"{term}%"), func.lower(Chat.title).like(f"%{term}%")),
            )
            .limit(20)
        )
    ).scalars().all()
    out = []
    for chat in rows:
        count = (await db.execute(select(func.count()).where(ChatMember.chat_id == chat.id))).scalar_one()
        out.append(_public_preview(chat, count))
    return out


@router.get("/{chat_id}")
async def get_chat(chat_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    chat = await db.get(Chat, chat_id)
    if chat is None:
        raise HTTPException(404, "Чат не найден")
    payloads, related = await chat_payloads(db, user.id, [chat_id])
    if payloads:
        return {"chat": payloads[0], "users": await users_by_ids(db, related)}
    if not chat.is_public:
        raise HTTPException(403, "Нет доступа")
    count = (await db.execute(select(func.count()).where(ChatMember.chat_id == chat.id))).scalar_one()
    return {"chat": _public_preview(chat, count), "users": []}


@router.patch("/{chat_id}")
async def update_chat(chat_id: int, body: UpdateChatIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    chat, member = await require_chat_member(db, chat_id, user.id)
    if chat.type not in ("group", "channel"):
        raise HTTPException(400, "Этот чат нельзя редактировать")
    if member.role not in ADMIN_ROLES:
        raise HTTPException(403, "Только администраторы могут менять чат")
    notes = []
    if body.title is not None and body.title.strip() != chat.title:
        chat.title = body.title.strip()
        notes.append(f"{user.display_name} изменил(а) название на «{chat.title}»")
    if body.description is not None:
        chat.description = body.description.strip()
    if body.remove_avatar:
        chat.avatar_url = None
    elif body.avatar_url is not None:
        if not body.avatar_url.startswith("/media/"):
            raise HTTPException(422, "Некорректный аватар")
        chat.avatar_url = body.avatar_url
        notes.append(f"{user.display_name} обновил(а) фото {'канала' if chat.type == 'channel' else 'группы'}")
    if body.is_public is not None:
        chat.is_public = body.is_public
        if not body.is_public:
            chat.username = None
    if body.username is not None and chat.is_public:
        chat.username = await _check_chat_username(db, body.username, chat.id)
    msgs = [await create_system_message(db, chat.id, user.id, n) for n in notes]
    await db.commit()
    for m in msgs:
        payload = await serialize_message(db, m)
        await manager.send_to_users(await member_ids(db, chat.id), {"type": "message.new", "message": payload})
    await push_chat(db, chat.id, await member_ids(db, chat.id))
    return await chat_payload(db, user.id, chat.id)


@router.delete("/{chat_id}")
async def delete_or_leave(chat_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    chat, member = await require_chat_member(db, chat_id, user.id)
    if chat.type in ("private", "saved") or member.role == "owner":
        uids = await delete_chat_completely(db, chat)
        await db.commit()
        await manager.send_to_users(uids, {"type": "chat.removed", "chat_id": chat_id})
        return {"ok": True}
    await db.delete(member)
    msg = None
    if chat.type == "group":
        msg = await create_system_message(db, chat.id, user.id, f"{user.display_name} покинул(а) группу")
    await db.commit()
    await manager.send_to_user(user.id, {"type": "chat.removed", "chat_id": chat_id})
    remaining = await member_ids(db, chat.id)
    if msg:
        payload = await serialize_message(db, msg)
        await manager.send_to_users(remaining, {"type": "message.new", "message": payload})
    await push_chat(db, chat.id, remaining)
    return {"ok": True}


@router.patch("/{chat_id}/settings")
async def chat_settings(chat_id: int, body: ChatSettingsIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _, member = await require_chat_member(db, chat_id, user.id)
    for field in ("pinned", "muted", "archived"):
        value = getattr(body, field)
        if value is not None:
            setattr(member, field, value)
    await db.commit()
    event = {
        "type": "chat.settings",
        "chat_id": chat_id,
        "pinned": member.pinned,
        "muted": member.muted,
        "archived": member.archived,
    }
    await manager.send_to_user(user.id, event)
    return event


@router.post("/{chat_id}/members")
async def add_members(chat_id: int, body: AddMembersIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    chat, member = await require_chat_member(db, chat_id, user.id)
    if chat.type not in ("group", "channel"):
        raise HTTPException(400, "В этот чат нельзя добавлять участников")
    if member.role not in ADMIN_ROLES and not (chat.type == "group" and chat.is_public):
        raise HTTPException(403, "Только администраторы могут добавлять участников")
    existing = set(await member_ids(db, chat_id))
    new_users = (
        await db.execute(select(User).where(User.id.in_(set(body.user_ids) - existing), User.is_bot.is_(False)))
    ).scalars().all()
    if not new_users:
        return {"added": []}
    for u in new_users:
        db.add(ChatMember(chat_id=chat_id, user_id=u.id, role="member"))
    await db.flush()
    names = ", ".join(u.display_name for u in new_users)
    msg = await create_system_message(db, chat_id, user.id, f"{user.display_name} добавил(а) {names}")
    await db.commit()
    all_ids = await member_ids(db, chat_id)
    payload = await serialize_message(db, msg)
    await manager.send_to_users(existing, {"type": "message.new", "message": payload})
    await push_chat(db, chat_id, [u.id for u in new_users], "chat.new")
    await push_chat(db, chat_id, existing)
    return {"added": [u.id for u in new_users], "member_ids": all_ids}


@router.delete("/{chat_id}/members/{user_id}")
async def remove_member(chat_id: int, user_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user_id == user.id:
        return await delete_or_leave(chat_id, user, db)
    chat, member = await require_chat_member(db, chat_id, user.id)
    if member.role not in ADMIN_ROLES:
        raise HTTPException(403, "Недостаточно прав")
    target = await db.get(ChatMember, (chat_id, user_id))
    if target is None:
        raise HTTPException(404, "Участник не найден")
    if target.role == "owner" or (target.role == "admin" and member.role != "owner"):
        raise HTTPException(403, "Нельзя удалить этого участника")
    target_user = await db.get(User, user_id)
    await db.delete(target)
    msg = await create_system_message(db, chat_id, user.id, f"{user.display_name} удалил(а) {target_user.display_name}")
    await db.commit()
    await manager.send_to_user(user_id, {"type": "chat.removed", "chat_id": chat_id})
    remaining = await member_ids(db, chat_id)
    payload = await serialize_message(db, msg)
    await manager.send_to_users(remaining, {"type": "message.new", "message": payload})
    await push_chat(db, chat_id, remaining)
    return {"ok": True}


@router.patch("/{chat_id}/members/{user_id}")
async def set_role(chat_id: int, user_id: int, body: RoleIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _, member = await require_chat_member(db, chat_id, user.id)
    if member.role != "owner":
        raise HTTPException(403, "Только владелец назначает администраторов")
    target = await db.get(ChatMember, (chat_id, user_id))
    if target is None or target.role == "owner":
        raise HTTPException(404, "Участник не найден")
    target.role = body.role
    await db.commit()
    await push_chat(db, chat_id, await member_ids(db, chat_id))
    return {"ok": True}


@router.post("/{chat_id}/join")
async def join_chat(chat_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    chat = await db.get(Chat, chat_id)
    if chat is None or not chat.is_public:
        raise HTTPException(404, "Чат не найден")
    if await db.get(ChatMember, (chat_id, user.id)) is None:
        db.add(ChatMember(chat_id=chat_id, user_id=user.id, role="member"))
        await db.flush()
        msg = None
        if chat.type == "group":
            msg = await create_system_message(db, chat_id, user.id, f"{user.display_name} присоединился(ась) к группе")
        else:
            last = (await db.execute(select(func.max(Message.id)).where(Message.chat_id == chat_id))).scalar()
            (await db.get(ChatMember, (chat_id, user.id))).last_read_id = last or 0
        await db.commit()
        if msg:
            payload = await serialize_message(db, msg)
            await manager.send_to_users(await member_ids(db, chat_id), {"type": "message.new", "message": payload})
        await push_chat(db, chat_id, [m for m in await member_ids(db, chat_id) if m != user.id] if chat.type == "group" else [])
    payloads, related = await chat_payloads(db, user.id, [chat_id])
    return {"chat": payloads[0], "users": await users_by_ids(db, related)}


@router.post("/{chat_id}/read")
async def mark_read(chat_id: int, body: ReadIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    chat, member = await require_chat_member(db, chat_id, user.id)
    if body.message_id > member.last_read_id:
        member.last_read_id = body.message_id
        await db.commit()
        event = {"type": "chat.read", "chat_id": chat_id, "user_id": user.id, "last_read_id": member.last_read_id}
        if chat.type == "channel":
            await manager.send_to_user(user.id, event)
        else:
            await manager.send_to_users(await member_ids(db, chat_id), event)
    return {"last_read_id": member.last_read_id}


@router.post("/{chat_id}/pin")
async def pin_message(chat_id: int, body: PinIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    chat, member = await require_chat_member(db, chat_id, user.id)
    if chat.type in ("group", "channel") and member.role not in ADMIN_ROLES:
        raise HTTPException(403, "Закреплять могут только администраторы")
    payload = None
    if body.message_id is not None:
        msg = await db.get(Message, body.message_id)
        if msg is None or msg.chat_id != chat_id:
            raise HTTPException(404, "Сообщение не найдено")
        chat.pinned_message_id = msg.id
        payload = await serialize_message(db, msg)
    else:
        chat.pinned_message_id = None
    await db.commit()
    await manager.send_to_users(await member_ids(db, chat_id), {"type": "chat.pinned", "chat_id": chat_id, "message": payload})
    return {"message": payload}


@router.get("/{chat_id}/shared")
async def shared_media(
    chat_id: int,
    kind: str = Query("media", pattern="^(media|files|voice|links)$"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_chat_member(db, chat_id, user.id)
    q = select(Message).where(Message.chat_id == chat_id, Message.type == "text")
    if kind == "links":
        q = q.where(or_(Message.text.like("%http://%"), Message.text.like("%https://%")))
    else:
        q = q.where(Message.attachments.is_not(None))
    rows = (await db.execute(q.order_by(Message.id.desc()).limit(300))).scalars().all()
    wanted = {"media": {"photo", "video"}, "files": {"file", "audio"}, "voice": {"voice", "video_note"}}.get(kind)
    if wanted:
        rows = [m for m in rows if any(a.get("kind") in wanted for a in (m.attachments or []))]
    return await serialize_messages(db, rows)
