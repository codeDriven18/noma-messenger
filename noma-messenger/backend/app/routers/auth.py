import random
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User
from ..onboarding import onboard_user
from ..schemas import LoginIn, PasswordChange, RegisterIn
from ..security import create_token, get_current_user, hash_password, verify_password
from ..services import user_public

router = APIRouter(prefix="/api/auth", tags=["auth"])

USERNAME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{3,31}$")


def normalize_username(raw: str) -> str:
    name = raw.strip().lstrip("@")
    if not USERNAME_RE.match(name):
        raise HTTPException(
            422, "Имя пользователя: 4–32 символа, латиница, цифры и _, начинается с буквы"
        )
    return name.lower()


@router.post("/register")
async def register(body: RegisterIn, db: AsyncSession = Depends(get_db)):
    username = normalize_username(body.username)
    exists = await db.execute(select(User.id).where(func.lower(User.username) == username))
    if exists.first():
        raise HTTPException(409, "Это имя пользователя уже занято")
    user = User(
        username=username,
        display_name=body.display_name.strip(),
        password_hash=hash_password(body.password),
        color=random.randint(0, 7),
    )
    db.add(user)
    await db.commit()
    await onboard_user(db, user)
    return {"token": create_token(user.id), "user": user_public(user)}


@router.post("/login")
async def login(body: LoginIn, db: AsyncSession = Depends(get_db)):
    username = body.username.strip().lstrip("@").lower()
    user = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if user is None or user.is_bot or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Неверное имя пользователя или пароль")
    return {"token": create_token(user.id), "user": user_public(user)}


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return user_public(user)


@router.post("/password")
async def change_password(
    body: PasswordChange, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    if not verify_password(body.old_password, user.password_hash):
        raise HTTPException(400, "Текущий пароль неверен")
    user.password_hash = hash_password(body.new_password)
    await db.commit()
    return {"ok": True}
