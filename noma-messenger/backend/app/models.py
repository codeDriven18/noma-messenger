from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .utils import utcnow


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(64))
    password_hash: Mapped[str] = mapped_column(String(128))
    bio: Mapped[str] = mapped_column(String(200), default="")
    avatar_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    color: Mapped[int] = mapped_column(Integer, default=0)
    is_bot: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[int] = mapped_column(primary_key=True)
    # private | group | channel | saved
    type: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(128), default="")
    description: Mapped[str] = mapped_column(String(500), default="")
    avatar_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    color: Mapped[int] = mapped_column(Integer, default=0)
    username: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    # "minId:maxId" for private chats, guarantees one dialog per pair
    private_key: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    pinned_message_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ChatMember(Base):
    __tablename__ = "chat_members"

    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    # owner | admin | member
    role: Mapped[str] = mapped_column(String(16), default="member")
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_read_id: Mapped[int] = mapped_column(Integer, default=0)
    muted: Mapped[bool] = mapped_column(Boolean, default=False)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_chat_id_id", "chat_id", "id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    chat_id: Mapped[int] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"))
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # text | system | call
    type: Mapped[str] = mapped_column(String(16), default="text")
    text: Mapped[str] = mapped_column(Text, default="")
    attachments: Mapped[list | None] = mapped_column(JSON, nullable=True)
    reply_to_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    forward_info: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    call_info: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    client_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class PushSubscription(Base):
    """Browser Web Push endpoint of one device; one user can have many."""

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    endpoint: Mapped[str] = mapped_column(String(1024), unique=True)
    p256dh: Mapped[str] = mapped_column(String(256))
    auth: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Reaction(Base):
    __tablename__ = "reactions"

    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    emoji: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
