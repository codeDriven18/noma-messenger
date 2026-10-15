"""Fill a local NOMA database with demo people, dialogs, a group and a channel.

    python seed_demo.py

Every demo account uses the password below — for local development only.
"""

import asyncio
import random
from datetime import timedelta

from sqlalchemy import select

from app.database import SessionLocal, init_db
from app.models import Chat, ChatMember, Message, Reaction, User
from app.onboarding import ensure_bot, onboard_user
from app.security import hash_password
from app.utils import utcnow

DEMO_PASSWORD = "noma1234"

PEOPLE = [
    ("demo", "Вы (демо)", "Тестирую NOMA 🚀", 0),
    ("alina", "Алина Соколова", "Дизайнер интерфейсов · люблю минимализм", 2),
    ("maks", "Макс Орлов", "Backend, Python, кофе ☕", 1),
    ("sofia", "София Ким", "Фотограф. Ловлю свет 📸", 4),
    ("artem", "Артём Белов", "", 6),
    ("kira", "Кира Волкова", "Путешествую и пишу", 7),
]


async def main() -> None:
    await init_db()
    async with SessionLocal() as db:
        if (await db.execute(select(User).where(User.username == "demo"))).scalar_one_or_none():
            print("Demo data already present — nothing to do.")
            return
        await ensure_bot(db)
        users: dict[str, User] = {}
        for username, name, bio, color in PEOPLE:
            u = User(username=username, display_name=name, password_hash=hash_password(DEMO_PASSWORD), bio=bio, color=color)
            db.add(u)
            await db.commit()
            await onboard_user(db, u)
            users[username] = u

        me = users["demo"]
        now = utcnow()

        async def dialog(peer: User, lines: list[tuple[str, str]], minutes_ago: int, unread: int = 0):
            a, b = sorted((me.id, peer.id))
            chat = Chat(type="private", private_key=f"{a}:{b}", created_by=peer.id, created_at=now - timedelta(minutes=minutes_ago + 60))
            db.add(chat)
            await db.flush()
            db.add_all([ChatMember(chat_id=chat.id, user_id=me.id), ChatMember(chat_id=chat.id, user_id=peer.id)])
            msgs = []
            t = now - timedelta(minutes=minutes_ago)
            for i, (who, text) in enumerate(lines):
                sender = me if who == "me" else peer
                m = Message(chat_id=chat.id, sender_id=sender.id, text=text, created_at=t + timedelta(minutes=i * 2))
                db.add(m)
                msgs.append(m)
            await db.flush()
            last_ids = [m.id for m in msgs]
            mine = await db.get(ChatMember, (chat.id, me.id))
            peer_m = await db.get(ChatMember, (chat.id, peer.id))
            mine.last_read_id = last_ids[-1 - unread] if unread else last_ids[-1]
            peer_m.last_read_id = last_ids[-1]
            return chat, msgs

        chat, msgs = await dialog(
            users["alina"],
            [
                ("peer", "Привет! Ты уже видел новый NOMA? 😍"),
                ("me", "Да! Этот чёрно-синий — просто космос"),
                ("peer", "А как тебе **живой фон**? Он светится, когда я печатаю ✨"),
                ("me", "Заметил 🔥 и остров сверху как в айфоне"),
                ("peer", "Попробуй свайпнуть сообщение влево — это ответ"),
                ("peer", "И двойной клик — мгновенный ❤️"),
            ],
            minutes_ago=25,
            unread=2,
        )
        msgs[3].reply_to_id = msgs[2].id
        db.add_all(
            [
                Reaction(message_id=msgs[1].id, user_id=users["alina"].id, emoji="❤️"),
                Reaction(message_id=msgs[2].id, user_id=me.id, emoji="🔥"),
            ]
        )

        await dialog(
            users["maks"],
            [
                ("peer", "Бэкенд на FastAPI поднял, WebSocket летает ⚡"),
                ("me", "Звонки тоже работают?"),
                ("peer", "Да, WebRTC напрямую между клиентами. Видео + демонстрация экрана"),
                ("me", "Огонь. Созвонимся вечером 📞"),
            ],
            minutes_ago=90,
        )
        await dialog(
            users["sofia"],
            [
                ("peer", "Скинешь фотки с выходных?"),
                ("me", "Конечно, вечером отправлю альбомом"),
                ("peer", "🥰"),
            ],
            minutes_ago=240,
            unread=1,
        )
        await dialog(
            users["kira"],
            [
                ("peer", "Я в Стамбуле! Тут невероятно 🌅"),
                ("me", "Завидую 😄 Привези лукум"),
            ],
            minutes_ago=60 * 26,
        )

        group = Chat(type="group", title="NOMA Team", description="Команда, которая делает лучший мессенджер 💙", color=1, created_by=me.id, created_at=now - timedelta(hours=30))
        db.add(group)
        await db.flush()
        for key, role in (("demo", "owner"), ("alina", "admin"), ("maks", "member"), ("sofia", "member"), ("artem", "member")):
            db.add(ChatMember(chat_id=group.id, user_id=users[key].id, role=role))
        await db.flush()
        g_lines = [
            ("demo", "system", "Вы (демо) создал(а) группу «NOMA Team»"),
            ("alina", "text", "Всем привет! Выкатила новые макеты 🎨"),
            ("maks", "text", "Бэкенд готов к релизу. Тесты зелёные ✅"),
            ("artem", "text", "Я протестил звонки — качество супер"),
            ("sofia", "text", "Сделаю промо-фото к запуску 📸"),
            ("demo", "text", "Команда мечты. Запускаемся в пятницу! 🚀"),
            ("maks", "text", "||Секрет: в пятницу будет торт|| 🎂"),
        ]
        g_msgs = []
        for i, (key, kind, text) in enumerate(g_lines):
            m = Message(chat_id=group.id, sender_id=users[key].id, type=kind, text=text, created_at=now - timedelta(minutes=50 - i * 3))
            db.add(m)
            g_msgs.append(m)
        await db.flush()
        for key in ("alina", "maks", "sofia", "artem"):
            db.add(Reaction(message_id=g_msgs[5].id, user_id=users[key].id, emoji=random.choice(["🔥", "🚀", "❤️"])))
        (await db.get(ChatMember, (group.id, me.id))).last_read_id = g_msgs[4].id
        group.pinned_message_id = g_msgs[5].id

        channel = Chat(type="channel", title="NOMA News", description="Официальные новости NOMA", username="nomanews", is_public=True, color=7, created_by=users["alina"].id, created_at=now - timedelta(days=3))
        db.add(channel)
        await db.flush()
        db.add(ChatMember(chat_id=channel.id, user_id=users["alina"].id, role="owner"))
        db.add(ChatMember(chat_id=channel.id, user_id=me.id, role="member"))
        for i, text in enumerate(
            [
                "**NOMA 1.0** уже здесь 🎉\n\nГолосовые, видео-кружки, звонки, реакции и живой дизайн.",
                "Совет дня: нажмите **Ctrl + K**, чтобы мгновенно перейти в любой чат 🔍",
            ]
        ):
            db.add(Message(chat_id=channel.id, sender_id=users["alina"].id, text=text, created_at=now - timedelta(hours=20 - i * 8)))
        await db.commit()
        print(f"Demo ready. Log in as 'demo' / '{DEMO_PASSWORD}' (or alina, maks, sofia, artem, kira).")


if __name__ == "__main__":
    asyncio.run(main())
