import ipaddress
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator


class RegisterIn(BaseModel):
    username: str = Field(min_length=4, max_length=32)
    display_name: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=6, max_length=128)


class LoginIn(BaseModel):
    username: str
    password: str


class ProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=64)
    username: str | None = Field(default=None, min_length=4, max_length=32)
    bio: str | None = Field(default=None, max_length=200)
    avatar_url: str | None = None
    remove_avatar: bool = False


class PasswordChange(BaseModel):
    old_password: str
    new_password: str = Field(min_length=6, max_length=128)


class Attachment(BaseModel):
    kind: Literal["photo", "video", "file", "voice", "video_note", "audio"]
    url: str
    name: str | None = Field(default=None, max_length=255)
    size: int | None = None
    mime: str | None = Field(default=None, max_length=120)
    width: int | None = None
    height: int | None = None
    duration: float | None = None
    waveform: list[int] | None = Field(default=None, max_length=128)
    thumb: str | None = None

    @field_validator("url", "thumb")
    @classmethod
    def _local_media(cls, v: str | None) -> str | None:
        if v is not None and not v.startswith("/media/"):
            raise ValueError("attachments must be uploaded first")
        return v


class SendMessageIn(BaseModel):
    text: str = Field(default="", max_length=8000)
    reply_to_id: int | None = None
    attachments: list[Attachment] = Field(default_factory=list, max_length=10)
    client_id: str | None = Field(default=None, max_length=64)


class EditMessageIn(BaseModel):
    text: str = Field(max_length=8000)


class DeleteMessagesIn(BaseModel):
    message_ids: list[int] = Field(min_length=1, max_length=200)


class ReactionIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


class ForwardIn(BaseModel):
    message_ids: list[int] = Field(min_length=1, max_length=100)
    chat_ids: list[int] = Field(min_length=1, max_length=20)
    comment: str = Field(default="", max_length=4000)


class PrivateChatIn(BaseModel):
    user_id: int


class CreateGroupIn(BaseModel):
    type: Literal["group", "channel"] = "group"
    title: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=500)
    member_ids: list[int] = Field(default_factory=list, max_length=500)
    avatar_url: str | None = None
    username: str | None = Field(default=None, max_length=32)
    is_public: bool = False


class UpdateChatIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=500)
    avatar_url: str | None = None
    remove_avatar: bool = False
    username: str | None = Field(default=None, max_length=32)
    is_public: bool | None = None


class ChatSettingsIn(BaseModel):
    pinned: bool | None = None
    muted: bool | None = None
    archived: bool | None = None


class AddMembersIn(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=200)


class RoleIn(BaseModel):
    role: Literal["admin", "member"]


class ReadIn(BaseModel):
    message_id: int


class PinIn(BaseModel):
    message_id: int | None = None


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=16, max_length=256)
    auth: str = Field(min_length=8, max_length=64)


class PushSubscribeIn(BaseModel):
    endpoint: str = Field(max_length=1024)
    keys: PushKeys

    @field_validator("endpoint")
    @classmethod
    def _push_service(cls, v: str) -> str:
        # The server POSTs to this URL, so only public https push services are accepted (no SSRF to the LAN).
        url = urlsplit(v)
        host = (url.hostname or "").lower()
        if url.scheme != "https" or not host or host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
            raise ValueError("Некорректный адрес push-сервиса")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            return v
        raise ValueError("Некорректный адрес push-сервиса")


class PushUnsubscribeIn(BaseModel):
    endpoint: str = Field(max_length=1024)
