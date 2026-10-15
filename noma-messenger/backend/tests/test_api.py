def private_chat(client, a, b):
    r = client.post("/api/chats/private", json={"user_id": b["id"]}, headers=a["headers"])
    assert r.status_code == 200, r.text
    return r.json()["chat"]


def test_register_onboards_saved_and_welcome(client, make_user):
    u = make_user("alice")
    chats = client.get("/api/chats", headers=u["headers"]).json()["chats"]
    kinds = sorted(c["type"] for c in chats)
    assert kinds == ["private", "saved"]
    welcome = next(c for c in chats if c["type"] == "private")
    assert welcome["unread_count"] == 1


def test_login_is_case_insensitive_and_rejects_bad_password(client, make_user):
    u = make_user("bob")
    assert client.post("/api/auth/login", json={"username": u["username"].upper(), "password": "secret1"}).status_code == 200
    assert client.post("/api/auth/login", json={"username": u["username"], "password": "nope"}).status_code == 401


def test_messages_reply_edit_react_read_delete(client, make_user):
    a, b = make_user("a"), make_user("b")
    chat = private_chat(client, a, b)
    m1 = client.post(f"/api/chats/{chat['id']}/messages", json={"text": "hi", "client_id": "c1"}, headers=a["headers"]).json()
    # idempotent by client_id
    again = client.post(f"/api/chats/{chat['id']}/messages", json={"text": "hi", "client_id": "c1"}, headers=a["headers"]).json()
    assert again["id"] == m1["id"]

    m2 = client.post(f"/api/chats/{chat['id']}/messages", json={"text": "yo", "reply_to_id": m1["id"]}, headers=b["headers"]).json()
    assert m2["reply_to"]["id"] == m1["id"]

    assert client.patch(f"/api/messages/{m1['id']}", json={"text": "hi!"}, headers=a["headers"]).json()["edited_at"]
    assert client.patch(f"/api/messages/{m1['id']}", json={"text": "hack"}, headers=b["headers"]).status_code == 403

    r = client.post(f"/api/messages/{m1['id']}/reactions", json={"emoji": "🔥"}, headers=b["headers"]).json()
    assert r["reactions"] == [{"emoji": "🔥", "count": 1, "user_ids": [b["id"]]}]
    r = client.post(f"/api/messages/{m1['id']}/reactions", json={"emoji": "🔥"}, headers=b["headers"]).json()
    assert r["reactions"] == []

    chats = {c["id"]: c for c in client.get("/api/chats", headers=b["headers"]).json()["chats"]}
    assert chats[chat["id"]]["peer_read_id"] == m1["id"]

    assert client.post("/api/messages/delete", json={"message_ids": [m2["id"]]}, headers=a["headers"]).status_code == 200
    msgs = client.get(f"/api/chats/{chat['id']}/messages", headers=a["headers"]).json()["messages"]
    assert [m["id"] for m in msgs] == [m1["id"]]


def test_outsider_cannot_read_private_chat(client, make_user):
    a, b, c = make_user("a"), make_user("b"), make_user("c")
    chat = private_chat(client, a, b)
    assert client.get(f"/api/chats/{chat['id']}/messages", headers=c["headers"]).status_code == 403
    assert client.post(f"/api/chats/{chat['id']}/messages", json={"text": "x"}, headers=c["headers"]).status_code == 403


def test_group_roles_and_channel_permissions(client, make_user):
    owner, m = make_user("own"), make_user("mem")
    g = client.post("/api/chats/group", json={"title": "G", "member_ids": [m["id"]]}, headers=owner["headers"]).json()["chat"]
    assert g["my_role"] == "owner" and sorted(g["member_ids"]) == sorted([owner["id"], m["id"]])
    assert client.patch(f"/api/chats/{g['id']}", json={"title": "New"}, headers=m["headers"]).status_code == 403

    ch = client.post(
        "/api/chats/group",
        json={"type": "channel", "title": "News", "is_public": True, "username": f"news{owner['id']}"},
        headers=owner["headers"],
    ).json()["chat"]
    found = client.get(f"/api/chats/search?q=news{owner['id']}", headers=m["headers"]).json()
    assert [c["id"] for c in found] == [ch["id"]]
    client.post(f"/api/chats/{ch['id']}/join", headers=m["headers"])
    assert client.post(f"/api/chats/{ch['id']}/messages", json={"text": "spam"}, headers=m["headers"]).status_code == 403
    assert client.post(f"/api/chats/{ch['id']}/messages", json={"text": "post"}, headers=owner["headers"]).status_code == 200


def test_forward_keeps_original_author(client, make_user):
    a, b = make_user("a"), make_user("b")
    chat = private_chat(client, a, b)
    m = client.post(f"/api/chats/{chat['id']}/messages", json={"text": "orig"}, headers=a["headers"]).json()
    saved = next(c for c in client.get("/api/chats", headers=b["headers"]).json()["chats"] if c["type"] == "saved")
    assert client.post("/api/messages/forward", json={"message_ids": [m["id"]], "chat_ids": [saved["id"]]}, headers=b["headers"]).json()["count"] == 1
    last = client.get(f"/api/chats/{saved['id']}/messages", headers=b["headers"]).json()["messages"][-1]
    assert last["forward"]["user_id"] == a["id"] and last["text"] == "orig"


def test_upload_and_range_requests(client, make_user):
    u = make_user("up")
    up = client.post("/api/upload", files={"file": ("a.png", b"\x89PNG0123456789", "image/png")}, headers=u["headers"]).json()
    assert up["url"].startswith("/media/") and up["size"] == 14
    r = client.get(up["url"], headers={"Range": "bytes=0-3"})
    assert r.status_code == 206 and r.content == b"\x89PNG"
    # active content is never served inline
    html = client.post("/api/upload", files={"file": ("x.html", b"<script>", "text/html")}, headers=u["headers"]).json()
    assert html["url"].endswith(".bin")


def test_call_signalling_and_log(client, make_user):
    a, b = make_user("caller"), make_user("callee")
    chat = private_chat(client, a, b)
    with client.websocket_connect(f"/ws?token={b['token']}") as wb, client.websocket_connect(f"/ws?token={a['token']}") as wa:
        assert wb.receive_json()["type"] == "hello"
        assert wa.receive_json()["type"] == "hello"
        wa.send_json({"type": "call.invite", "call_id": "k1", "chat_id": chat["id"], "video": False})
        incoming = next(e for e in iter(wb.receive_json, None) if e["type"] == "call.incoming")
        assert incoming["from_user_id"] == a["id"]
        assert wa.receive_json()["type"] == "call.ringing"
        wb.send_json({"type": "call.accept", "call_id": "k1"})
        assert wa.receive_json()["type"] == "call.accepted"
        wa.send_json({"type": "call.signal", "call_id": "k1", "data": {"type": "offer", "sdp": "v=0"}})
        assert wb.receive_json()["data"]["type"] == "offer"
        wb.send_json({"type": "call.end", "call_id": "k1"})
        assert next(e for e in iter(wa.receive_json, None) if e["type"] == "call.ended")
        logged = next(e for e in iter(wa.receive_json, None) if e["type"] == "message.new")
        assert logged["message"]["type"] == "call"
    calls = client.get("/api/calls", headers=a["headers"]).json()["calls"]
    assert calls[0]["call"]["status"] == "ended"
