from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User
from ..schemas import ProfileUpdate
from ..security import get_current_user
from ..services import contact_ids, user_public
from ..ws_manager import manager
from .auth import normalize_username

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/search")
async def search_users(
    q: str = Query("", max_length=64),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    term = q.strip().lstrip("@").lower()
    if not term:
        return []
    like = f"%{term}%"
    rows = (
        await db.execute(
            select(User)
            .where(
                User.id != user.id,
                or_(User.username.like(f"{term}%"), func.lower(User.display_name).like(like)),
            )
            .order_by(User.is_bot.desc(), User.username)
            .limit(30)
        )
    ).scalars().all()
    return [user_public(u) for u in rows]


@router.get("/contacts")
async def contacts(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ids = await contact_ids(db, user.id)
    if not ids:
        return []
    rows = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    return [user_public(u) for u in rows]


@router.post("/batch")
async def users_batch(ids: list[int], _: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not ids:
        return []
    rows = (await db.execute(select(User).where(User.id.in_(ids[:500])))).scalars().all()
    return [user_public(u) for u in rows]


@router.get("/{user_id}")
async def get_user(user_id: int, _: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(404, "Пользователь не найден")
    return user_public(target)


@router.patch("/me")
async def update_me(
    body: ProfileUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    if body.username is not None:
        username = normalize_username(body.username)
        if username != user.username:
            taken = await db.execute(select(User.id).where(User.username == username, User.id != user.id))
            if taken.first():
                raise HTTPException(409, "Это имя пользователя уже занято")
            user.username = username
    if body.display_name is not None:
        user.display_name = body.display_name.strip()
    if body.bio is not None:
        user.bio = body.bio.strip()
    if body.remove_avatar:
        user.avatar_url = None
    elif body.avatar_url is not None:
        if not body.avatar_url.startswith("/media/"):
            raise HTTPException(422, "Некорректный аватар")
        user.avatar_url = body.avatar_url
    await db.commit()
    payload = user_public(user)
    audience = await contact_ids(db, user.id)
    await manager.send_to_users([*audience, user.id], {"type": "user.update", "user": payload})
    return payload
