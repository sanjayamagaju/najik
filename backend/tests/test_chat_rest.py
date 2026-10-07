from __future__ import annotations

import uuid

import pytest

from apps.chat.models import ConversationMember, Message
from tests.conftest import Login, make_user
from tests.test_auth import assert_error

pytestmark = pytest.mark.django_db


@pytest.fixture
def pair():
    a, b = Login(make_user("alice")), Login(make_user("bob"))
    r = a.client.post("/api/v1/conversations", {"user_id": str(b.user.id)}, format="json")
    assert r.status_code == 201
    return a, b, r.json()["id"]


def send(login, conv_id, body="hello", client_id=None):
    return login.client.post(
        f"/api/v1/conversations/{conv_id}/messages",
        {"client_id": str(client_id or uuid.uuid4()), "body": body},
        format="json",
    )


def test_get_or_create_conversation(pair):
    a, b, conv_id = pair
    r = b.client.post("/api/v1/conversations", {"user_id": str(a.user.id)}, format="json")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == conv_id
    assert body["peer"]["id"] == str(a.user.id)
    assert body == {
        "id": conv_id,
        "peer": body["peer"],
        "last_message": None,
        "last_seq": 0,
        "unread_count": 0,
        "my_read_seq": 0,
        "peer_delivered_seq": 0,
        "peer_read_seq": 0,
        "updated_at": body["updated_at"],
    }
    assert_error(
        a.client.post("/api/v1/conversations", {"user_id": str(a.user.id)}, format="json"),
        400,
        "validation_error",
    )
    assert_error(
        a.client.post("/api/v1/conversations", {"user_id": str(uuid.uuid4())}, format="json"),
        404,
        "not_found",
    )


def test_non_members_get_404(pair):
    _, _, conv_id = pair
    eve = Login(make_user("eve"))
    base = f"/api/v1/conversations/{conv_id}"
    assert_error(eve.client.get(base), 404, "not_found")
    assert_error(eve.client.get(f"{base}/messages"), 404, "not_found")
    assert_error(send(eve, conv_id), 404, "not_found")
    assert_error(eve.client.post(f"{base}/read", {"seq": 1}, format="json"), 404, "not_found")
    assert_error(
        eve.client.post(f"{base}/ping", {"client_id": str(uuid.uuid4())}, format="json"),
        404,
        "not_found",
    )
    assert_error(eve.client.get(f"/api/v1/conversations/{uuid.uuid4()}"), 404, "not_found")


def test_send_is_idempotent(pair):
    a, b, conv_id = pair
    client_id = uuid.uuid4()
    r1 = send(a, conv_id, "hi there", client_id)
    assert r1.status_code == 201
    msg = r1.json()
    assert msg["seq"] == 1 and msg["kind"] == "text" and msg["body"] == "hi there"
    assert msg["client_id"] == str(client_id) and msg["sender_id"] == str(a.user.id)
    assert msg["meta"] == {}
    r2 = send(a, conv_id, "hi there", client_id)
    assert r2.status_code == 200
    assert r2.json() == msg
    assert Message.objects.count() == 1

    # The same client_id in a different conversation is a conflict.
    c = Login(make_user("carol"))
    other = a.client.post("/api/v1/conversations", {"user_id": str(c.user.id)}, format="json")
    assert_error(send(a, other.json()["id"], "x", client_id), 409, "conflict")
    # Another sender may use the same client_id.
    assert send(b, conv_id, "yo", client_id).status_code == 201


def test_body_validation(pair):
    a, _, conv_id = pair
    assert_error(send(a, conv_id, "   "), 400, "validation_error")
    assert_error(send(a, conv_id, "x" * 4001), 400, "validation_error")
    assert send(a, conv_id, "x" * 4000).status_code == 201
    r = send(a, conv_id, "  a\u0000b\u0007\tc\nd 👋‍  ")
    assert r.json()["body"] == "ab\tc\nd 👋‍"
    r = a.client.post(
        f"/api/v1/conversations/{conv_id}/messages",
        {"client_id": "not-a-uuid", "body": "x"},
        format="json",
    )
    assert "client_id" in assert_error(r, 400, "validation_error")["details"]


def test_seq_is_gap_free_and_paging(pair):
    a, b, conv_id = pair
    for i in range(30):
        assert send(a if i % 2 else b, conv_id, f"m{i}").status_code == 201
    seqs = list(Message.objects.order_by("seq").values_list("seq", flat=True))
    assert seqs == list(range(1, 31))

    url = f"/api/v1/conversations/{conv_id}/messages"
    latest = a.client.get(f"{url}?limit=10").json()
    assert [m["seq"] for m in latest["results"]] == list(range(21, 31))
    assert latest["has_more"] is True
    older = a.client.get(f"{url}?before_seq=21&limit=10").json()
    assert [m["seq"] for m in older["results"]] == list(range(11, 21))
    oldest = a.client.get(f"{url}?before_seq=11&limit=10").json()
    assert [m["seq"] for m in oldest["results"]] == list(range(1, 11))
    assert oldest["has_more"] is False
    forward = a.client.get(f"{url}?after_seq=5&limit=10").json()
    assert [m["seq"] for m in forward["results"]] == list(range(6, 16))
    assert forward["has_more"] is True
    tail = a.client.get(f"{url}?after_seq=25&limit=10").json()
    assert [m["seq"] for m in tail["results"]] == list(range(26, 31))
    assert tail["has_more"] is False
    assert len(a.client.get(f"{url}?limit=500").json()["results"]) == 30
    assert_error(a.client.get(f"{url}?before_seq=5&after_seq=1"), 400, "validation_error")
    assert_error(a.client.get(f"{url}?limit=abc"), 400, "validation_error")


def test_message_rate_limit(pair, settings):
    settings.RATE_LIMITS = {**settings.RATE_LIMITS, "message_burst": "3/10"}
    a, _, conv_id = pair
    for _ in range(3):
        assert send(a, conv_id).status_code == 201
    r = send(a, conv_id)
    assert_error(r, 429, "rate_limited")
    assert "Retry-After" in r


def test_watermarks_and_unread(pair):
    a, b, conv_id = pair
    for i in range(3):
        send(a, conv_id, f"a{i}")
    send(b, conv_id, "b0")  # seq 4: Bob's own message never counts as unread for Bob
    send(a, conv_id, "a3")  # seq 5

    conv_b = b.client.get(f"/api/v1/conversations/{conv_id}").json()
    assert conv_b["unread_count"] == 4 and conv_b["last_seq"] == 5
    assert conv_b["last_message"]["seq"] == 5

    r = b.client.post(f"/api/v1/conversations/{conv_id}/read", {"seq": 2}, format="json")
    assert r.status_code == 200
    assert r.json() == {
        "conversation_id": conv_id,
        "delivered_seq": 2,
        "read_seq": 2,
        "unread_count": 2,
    }
    # Regression is ignored.
    r = b.client.post(f"/api/v1/conversations/{conv_id}/read", {"seq": 1}, format="json")
    assert r.json()["read_seq"] == 2 and r.json()["unread_count"] == 2
    # Values beyond last_seq are clamped.
    r = b.client.post(f"/api/v1/conversations/{conv_id}/read", {"seq": 99}, format="json")
    assert r.json()["read_seq"] == 5 and r.json()["unread_count"] == 0

    conv_a = a.client.get(f"/api/v1/conversations/{conv_id}").json()
    assert conv_a["peer_read_seq"] == 5 and conv_a["peer_delivered_seq"] == 5
    assert conv_a["unread_count"] == 1  # Bob's message
    assert_error(
        b.client.post(f"/api/v1/conversations/{conv_id}/read", {"seq": -1}, format="json"),
        400,
        "validation_error",
    )


def test_delivered_watermark_is_monotonic(pair):
    from apps.chat import services

    a, b, conv_id = pair
    for _ in range(4):
        send(a, conv_id)
    services.mark(b.user.id, uuid.UUID(conv_id), delivered_seq=3)
    services.mark(b.user.id, uuid.UUID(conv_id), delivered_seq=1)
    member = ConversationMember.objects.get(user=b.user)
    assert (member.delivered_seq, member.read_seq) == (3, 0)
    services.mark(b.user.id, uuid.UUID(conv_id), delivered_seq=50)
    member.refresh_from_db()
    assert member.delivered_seq == 4


def test_conversation_list_order_cursor_and_empty_hidden():
    me = Login(make_user("me"))
    peers = [Login(make_user(f"peer{i}")) for i in range(4)]
    conv_ids = []
    for p in peers:
        conv_ids.append(
            me.client.post(
                "/api/v1/conversations", {"user_id": str(p.user.id)}, format="json"
            ).json()["id"]
        )
    # peer3's conversation stays empty and is hidden; activity order: 1, 0, 2 (newest first: 2)
    for idx in (1, 0, 2):
        send(peers[idx], conv_ids[idx], "hi")
    r = me.client.get("/api/v1/conversations?limit=2")
    body = r.json()
    assert [c["id"] for c in body["results"]] == [conv_ids[2], conv_ids[0]]
    assert body["next_cursor"]
    r2 = me.client.get(f"/api/v1/conversations?limit=2&cursor={body['next_cursor']}")
    assert [c["id"] for c in r2.json()["results"]] == [conv_ids[1]]
    assert r2.json()["next_cursor"] is None
    assert me.client.get("/api/v1/conversations?cursor=garbage").status_code == 400
    assert body["results"][0]["unread_count"] == 1


def test_presence_endpoint_only_for_shared_users(pair):
    a, b, _ = pair
    stranger = make_user("stranger")
    r = a.client.get(f"/api/v1/presence?user_ids={b.user.id},{stranger.id}")
    assert r.status_code == 200
    assert r.json() == {
        "results": [{"user_id": str(b.user.id), "online": False, "last_seen_at": None}]
    }
    assert_error(a.client.get("/api/v1/presence?user_ids=nope"), 400, "validation_error")


def test_ping_rest_and_rate_limit(pair):
    a, b, conv_id = pair
    url = f"/api/v1/conversations/{conv_id}/ping"
    r = a.client.post(url, {"client_id": str(uuid.uuid4())}, format="json")
    assert r.status_code == 201
    assert r.json()["kind"] == "ping" and r.json()["body"] == ""
    r = a.client.post(url, {"client_id": str(uuid.uuid4())}, format="json")
    assert_error(r, 429, "rate_limited")
    # Bob can still ping Alice.
    assert b.client.post(url, {"client_id": str(uuid.uuid4())}, format="json").status_code == 201
