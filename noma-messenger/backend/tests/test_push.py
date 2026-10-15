import base64
import json
import os
from pathlib import Path

import pytest
from sqlalchemy import select

from app import push
from app.database import SessionLocal
from app.models import PushSubscription

KEYS = {"p256dh": "B" + "x" * 86, "auth": "a" * 22}


@pytest.fixture
def sent(client, monkeypatch):
    """Replaces the real push service call; every delivery lands in the returned list."""
    calls: list[dict] = []
    status: dict[str, int] = {}

    def fake_deliver(subscription, data, ttl):
        calls.append({"endpoint": subscription["endpoint"], "payload": json.loads(data), "ttl": ttl})
        return status.get(subscription["endpoint"])

    monkeypatch.setattr(push, "deliver", fake_deliver)
    yield calls, status
    flush(client)  # never let a queued push outlive the mock


def flush(client):
    client.portal.call(push.drain)


def subscribe(client, user, device: str) -> str:
    endpoint = f"https://fcm.googleapis.com/fcm/send/{device}"
    r = client.post("/api/push/subscribe", json={"endpoint": endpoint, "keys": KEYS}, headers=user["headers"])
    assert r.status_code == 200, r.text
    return endpoint


def owners(client) -> dict[str, int]:
    async def _query():
        async with SessionLocal() as db:
            rows = (await db.execute(select(PushSubscription.endpoint, PushSubscription.user_id))).all()
        return dict(rows)

    return client.portal.call(_query)


def test_vapid_key_is_generated_and_persisted(client):
    key = client.get("/api/push/vapid-key").json()["public_key"]
    raw = base64.urlsafe_b64decode(key + "=" * (-len(key) % 4))
    assert len(raw) == 65 and raw[0] == 4  # uncompressed P-256 point, as PushManager expects
    assert (Path(os.environ["NOMA_DATA_DIR"]) / "vapid_private.pem").is_file()


def test_subscribe_upsert_and_unsubscribe(client, make_user):
    a, b = make_user("pa"), make_user("pb")
    body = {"endpoint": "https://fcm.googleapis.com/fcm/send/x", "keys": KEYS}
    assert client.post("/api/push/subscribe", json=body).status_code == 401
    for bad in ("http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://localhost:8000/x", "https://[::1]/x"):
        r = client.post("/api/push/subscribe", json={**body, "endpoint": bad}, headers=a["headers"])
        assert r.status_code == 422, bad

    ep = subscribe(client, a, f"dev-{a['id']}")
    subscribe(client, a, f"dev-{a['id']}")  # idempotent
    assert owners(client)[ep] == a["id"]
    # the same browser signs in as someone else: the endpoint moves to the new account
    subscribe(client, b, f"dev-{a['id']}")
    assert owners(client)[ep] == b["id"]

    # only the owner can remove it
    client.request("DELETE", "/api/push/subscribe", json={"endpoint": ep}, headers=a["headers"])
    assert ep in owners(client)
    assert client.request("DELETE", "/api/push/subscribe", json={"endpoint": ep}, headers=b["headers"]).status_code == 200
    assert ep not in owners(client)


def test_push_goes_only_to_offline_unmuted_members(client, make_user, sent):
    calls, _ = sent
    sender, online, offline, muted = make_user("sender"), make_user("online"), make_user("offline"), make_user("muted")
    endpoints = {u["id"]: subscribe(client, u, f"grp-{u['id']}") for u in (sender, online, offline, muted)}
    group = client.post(
        "/api/chats/group",
        json={"title": "Команда", "member_ids": [online["id"], offline["id"], muted["id"]]},
        headers=sender["headers"],
    ).json()["chat"]
    assert client.patch(f"/api/chats/{group['id']}/settings", json={"muted": True}, headers=muted["headers"]).status_code == 200
    flush(client)
    calls.clear()

    with client.websocket_connect(f"/ws?token={online['token']}") as ws:
        assert ws.receive_json()["type"] == "hello"
        msg = client.post(
            f"/api/chats/{group['id']}/messages", json={"text": "**Привет**, ответ: ||42||"}, headers=sender["headers"]
        ).json()
        assert next(e for e in iter(ws.receive_json, None) if e["type"] == "message.new")["message"]["id"] == msg["id"]
        flush(client)

    assert [c["endpoint"] for c in calls] == [endpoints[offline["id"]]]
    payload = calls[0]["payload"]
    assert payload["type"] == "message" and payload["chat_id"] == group["id"] and payload["message_id"] == msg["id"]
    assert payload["title"] == "Команда" and payload["tag"] == f"chat-{group['id']}"
    assert payload["body"] == "Sender: Привет, ответ: ▒▒▒▒"  # markup stripped, spoiler hidden on the lock screen

    # nobody gets pushed once everyone is online or the chat is muted for them
    calls.clear()
    with client.websocket_connect(f"/ws?token={offline['token']}") as ws:
        assert ws.receive_json()["type"] == "hello"
        client.post(f"/api/chats/{group['id']}/messages", json={"text": "ещё"}, headers=sender["headers"])
        flush(client)
    assert calls == []


def test_private_message_and_forward_batch(client, make_user, sent):
    calls, _ = sent
    a, b = make_user("fa"), make_user("fb")
    ep = subscribe(client, b, f"pm-{b['id']}")
    chat = client.post("/api/chats/private", json={"user_id": b["id"]}, headers=a["headers"]).json()["chat"]
    m1 = client.post(f"/api/chats/{chat['id']}/messages", json={"text": "раз"}, headers=a["headers"]).json()
    m2 = client.post(f"/api/chats/{chat['id']}/messages", json={"text": "два"}, headers=a["headers"]).json()
    flush(client)
    assert [(c["endpoint"], c["payload"]["title"], c["payload"]["body"]) for c in calls] == [(ep, "Fa", "раз"), (ep, "Fa", "два")]

    calls.clear()
    client.post(
        "/api/messages/forward",
        json={"message_ids": [m1["id"], m2["id"]], "chat_ids": [chat["id"]], "comment": "смотри"},
        headers=a["headers"],
    )
    flush(client)
    assert len(calls) == 1  # one notification per forwarded batch, not per message
    assert calls[0]["payload"]["body"] == "смотри\n↪ Пересланные сообщения · 2"


def test_expired_subscription_is_dropped(client, make_user, sent):
    calls, status = sent
    a, b = make_user("ea"), make_user("eb")
    ep = subscribe(client, b, f"gone-{b['id']}")
    status[ep] = 410
    chat = client.post("/api/chats/private", json={"user_id": b["id"]}, headers=a["headers"]).json()["chat"]
    client.post(f"/api/chats/{chat['id']}/messages", json={"text": "ау"}, headers=a["headers"])
    flush(client)
    assert [c["endpoint"] for c in calls] == [ep]
    assert ep not in owners(client)


def test_call_invite_pushes_offline_callee(client, make_user, sent):
    calls, _ = sent
    a, b = make_user("ca"), make_user("cb")
    ep = subscribe(client, b, f"call-{b['id']}")
    chat = client.post("/api/chats/private", json={"user_id": b["id"]}, headers=a["headers"]).json()["chat"]
    with client.websocket_connect(f"/ws?token={a['token']}") as wa:
        assert wa.receive_json()["type"] == "hello"
        wa.send_json({"type": "call.invite", "call_id": "push1", "chat_id": chat["id"], "video": True})
        assert wa.receive_json() == {"type": "call.ringing", "call_id": "push1", "peer_online": False}
        flush(client)
        assert len(calls) == 1 and calls[0]["endpoint"] == ep
        payload = calls[0]["payload"]
        assert payload["type"] == "call" and payload["chat_id"] == chat["id"] and payload["tag"] == "call-push1"
        assert payload["body"] == "Входящий видеозвонок" and calls[0]["ttl"] <= 60

        # the callee opens the app from the notification and can still pick up
        with client.websocket_connect(f"/ws?token={b['token']}") as wb:
            assert wb.receive_json()["type"] == "hello"
            incoming = wb.receive_json()
            assert incoming["type"] == "call.incoming" and incoming["call_id"] == "push1"
            assert next(e for e in iter(wa.receive_json, None) if e["type"] == "call.ringing")["peer_online"] is True
            wb.send_json({"type": "call.reject", "call_id": "push1"})
            assert next(e for e in iter(wa.receive_json, None) if e["type"] == "call.ended")["reason"] == "declined"

        # caller gives up while the callee is offline: the push turns into a missed call
        calls.clear()
        wa.send_json({"type": "call.invite", "call_id": "push2", "chat_id": chat["id"], "video": False})
        assert next(e for e in iter(wa.receive_json, None) if e["type"] == "call.ringing")["peer_online"] is False
        wa.send_json({"type": "call.end", "call_id": "push2"})
        assert next(e for e in iter(wa.receive_json, None) if e["type"] == "call.ended")
        flush(client)
    by_type = {c["payload"]["type"]: c["payload"] for c in calls}
    assert len(calls) == 2 and set(by_type) == {"call", "call.missed"}
    assert by_type["call.missed"]["tag"] == by_type["call"]["tag"] == "call-push2"  # replaces the ringing notification
    assert by_type["call.missed"]["body"] == "📞 Пропущенный звонок"
