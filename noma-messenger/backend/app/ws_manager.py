import asyncio
import json
import logging
from collections import defaultdict
from typing import Iterable

from fastapi import WebSocket

log = logging.getLogger("noma.ws")


class ConnectionManager:
    """Keeps every open socket per user and fans out realtime events."""

    def __init__(self) -> None:
        self.active: dict[int, set[WebSocket]] = defaultdict(set)

    def connect(self, user_id: int, ws: WebSocket) -> bool:
        first = not self.active.get(user_id)
        self.active[user_id].add(ws)
        return first

    def disconnect(self, user_id: int, ws: WebSocket) -> bool:
        sockets = self.active.get(user_id)
        if not sockets:
            return False
        sockets.discard(ws)
        if not sockets:
            self.active.pop(user_id, None)
            return True
        return False

    def is_online(self, user_id: int) -> bool:
        return bool(self.active.get(user_id))

    async def _send(self, ws: WebSocket, text: str) -> None:
        try:
            await ws.send_text(text)
        except Exception:  # socket closed mid-send; cleanup happens in the reader loop
            log.debug("send failed", exc_info=True)

    async def send_ws(self, ws: WebSocket, event: dict) -> None:
        await self._send(ws, json.dumps(event, ensure_ascii=False))

    async def send_to_user(self, user_id: int, event: dict, exclude: WebSocket | None = None) -> None:
        sockets = [s for s in self.active.get(user_id, ()) if s is not exclude]
        if not sockets:
            return
        text = json.dumps(event, ensure_ascii=False)
        await asyncio.gather(*(self._send(s, text) for s in sockets))

    async def send_to_users(self, user_ids: Iterable[int], event: dict) -> None:
        text = json.dumps(event, ensure_ascii=False)
        targets = [s for uid in set(user_ids) for s in self.active.get(uid, ())]
        if targets:
            await asyncio.gather(*(self._send(s, text) for s in targets))


manager = ConnectionManager()
