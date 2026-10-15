"""Official NOMA account, Saved Messages and the welcome dialog for new users."""

import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Chat, ChatMember, Message, User
from .security import hash_password
from .utils import utcnow

BOT_USERNAME = "noma"

WELCOME_TEXT = """Добро пожаловать в **NOMA** 💙

Это мессенджер нового поколения — быстрый, живой и красивый. Несколько подсказок:

• **Свайп влево** по сообщению — ответить
• **Двойной клик** — мгновенная реакция ❤️
• **Правый клик / долгое нажатие** — меню с реакциями, пересылкой, закреплением
• **Удерживайте микрофон** — голосовое, потяните вверх чтобы зафиксировать запись
• Нажмите на микрофон один раз — переключитесь на **видео-кружок**
• Форматирование: **жирный**, __курсив__, `код`, ~~зачёркнутый~~, ||спойлер||

Найдите друзей через поиск 🔍 и начните общение. Звонки и видеозвонки — в шапке любого личного чата."""


async def ensure_bot(db: AsyncSession) -> User:
    bot = (await db.execute(select(User).where(User.username == BOT_USERNAME))).scalar_one_or_none()
    if bot is None:
        bot = User(
            username=BOT_USERNAME,
            display_name="NOMA",
            password_hash=hash_password(secrets.token_urlsafe(32)),
            bio="Официальный аккаунт NOMA. Новости, советы и обновления.",
            color=0,
            is_bot=True,
        )
        db.add(bot)
        await db.commit()
    return bot


async def onboard_user(db: AsyncSession, user: User) -> None:
    now = utcnow()
    saved = Chat(type="saved", title="Избранное", private_key=f"{user.id}:{user.id}", created_by=user.id, created_at=now)
    db.add(saved)
    await db.flush()
    db.add(ChatMember(chat_id=saved.id, user_id=user.id, role="owner"))

    bot = await ensure_bot(db)
    dialog = Chat(type="private", private_key=f"{bot.id}:{user.id}", created_by=bot.id, created_at=now)
    db.add(dialog)
    await db.flush()
    db.add_all(
        [
            ChatMember(chat_id=dialog.id, user_id=user.id, role="member"),
            ChatMember(chat_id=dialog.id, user_id=bot.id, role="member"),
        ]
    )
    db.add(Message(chat_id=dialog.id, sender_id=bot.id, type="text", text=WELCOME_TEXT, created_at=now))
    await db.commit()
