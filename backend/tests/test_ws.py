from __future__ import annotations

import asyncio
import json
import uuid

import jwt
import pytest
from django.conf import settings

from apps.accounts import services as account_services
from apps.chat import services as chat_services
from tests.conftest import (
    Login,
    adb,
    closed_with,
    drain,
    make_user,
    recv_type,
    request,
    ws_connect,
    ws_open,
)

pytestmark = pytest.mark.django_db(transaction=True)


async def setup_pair():
    alice = await adb(make_user)("alice", display_name="Alice")
    bob = await adb(make_user)("bob", display_name="Bob")
    a, b = await adb(Login)(alice), await adb(Login)(bob)
    conv, _ = await adb(chat_services.get_or_create_conversation)(alice, bob.id)
    return a, b, str(conv.id)


# --- connection lifecycle ---------------------------------------------------------------
async def test_auth_timeout_closes_4001():
    comm = await ws_open()
    assert await closed_with(comm, timeout=3) == 4001


async def test_first_frame_must_be_auth():
    comm = await ws_open()
    await comm.send_json_to({"type": "hb"})
    assert await closed_with(comm) == 4001


async def test_auth_missing_token_closes_4001():
    comm = await ws_open()
    await comm.send_json_to({"type": "auth", "id": "1", "data": {}})
    ack = await comm.receive_json_from()
    assert ack["ok"] is False and ack["id"] == "1"
    assert await closed_with(comm) == 4001


async def test_invalid_token_closes_4004():
    comm = await ws_open()
    await comm.send_json_to({"type": "auth", "id": "1", "data": {"token": "garbage"}})
    ack = await comm.receive_json_from()
    assert ack == {
        "type": "ack",
        "id": "1",
        "ok": False,
        "error": {"code": "token_invalid", "message": "Invalid token."},
    }
    assert await closed_with(comm) == 4004


async def test_expired_token_closes_4003():
    user = await adb(make_user)("arjun")
    login = await adb(Login)(user)
    expired = jwt.encode(
        {
            "sub": str(user.id),
            "sid": str(login.session.id),
            "jti": "x",
            "iat": 1,
            "exp": 2,
            "type": "access",
        },
        settings.JWT_SIGNING_KEY,
        algorithm="HS256",
    )
    comm = await ws_open()
    await comm.send_json_to({"type": "auth", "id": "1", "data": {"token": expired}})
    assert (await comm.receive_json_from())["error"]["code"] == "token_expired"
    assert await closed_with(comm) == 4003


async def test_revoked_session_closes_4004():
    user = await adb(make_user)("arjun")
    login = await adb(Login)(user)
    await adb(account_services.revoke_sessions)([login.session], reason="test")
    comm = await ws_open()
    await comm.send_json_to({"type": "auth", "id": "1", "data": {"token": login.access}})
    assert (await comm.receive_json_from())["error"]["code"] == "session_revoked"
    assert await closed_with(comm) == 4004


async def test_auth_ack_shape_and_heartbeat():
    user = await adb(make_user)("arjun")
    login = await adb(Login)(user)
    comm = await ws_open()
    await comm.send_json_to({"type": "auth", "id": "a1", "data": {"token": login.access}})
    ack = await comm.receive_json_from()
    assert ack["type"] == "ack" and ack["id"] == "a1" and ack["ok"] is True
    data = ack["data"]
    assert data["user_id"] == str(user.id) and data["session_id"] == str(login.session.id)
    assert data["heartbeat_sec"] == 25 and data["server_time"].endswith("Z")
    await comm.send_json_to({"type": "hb"})
    assert await comm.receive_json_from() == {"type": "hb"}
    await comm.disconnect()


async def test_malformed_and_oversized_frames_close_4009():
    user = await adb(make_user)("arjun")
    login = await adb(Login)(user)
    comm = await ws_connect(login.access)
    await comm.send_to(text_data="{not json")
    assert await closed_with(comm) == 4009

    comm = await ws_connect(login.access)
    big = json.dumps({"type": "hb", "data": {"x": "y" * (64 * 1024)}})
    await comm.send_to(text_data=big)
    assert await closed_with(comm) == 4009

    comm = await ws_connect(login.access)
    await comm.send_to(bytes_data=b"\x00\x01")
    assert await closed_with(comm) == 4009

    comm = await ws_connect(login.access)
    await comm.send_json_to({"type": "hb", "extra": True})
    assert await closed_with(comm) == 4009


async def test_idle_timeout(settings):
    settings.WS_HEARTBEAT_SEC = 0.3
    user = await adb(make_user)("arjun")
    login = await adb(Login)(user)
    comm = await ws_connect(login.access)
    assert await closed_with(comm, timeout=3) == 1001


async def test_ack_protocol():
    a, _, conv_id = await setup_pair()
    comm = await ws_connect(a.access)
    ack = await request(comm, "does.not.exist", {}, "x1")
    assert ack == {
        "type": "ack",
        "id": "x1",
        "ok": False,
        "error": {"code": "unknown_type", "message": "Unknown frame type."},
    }
    ack = await request(comm, "typing", {"conversation_id": conv_id, "state": "dancing"}, "x2")
    assert ack["ok"] is False and ack["error"]["code"] == "validation_error"
    assert "state" in ack["error"]["details"]
    ack = await request(
        comm, "typing", {"conversation_id": conv_id, "state": "start", "x": 1}, "x3"
    )
    assert ack["error"]["code"] == "validation_error"
    ack = await request(comm, "message.read", {"conversation_id": conv_id, "seq": "1"}, "x4")
    assert ack["error"]["code"] == "validation_error"  # no coercion from strings
    # Integer ids are echoed back as-is.
    await comm.send_json_to({"type": "app.state", "id": 7, "data": {"state": "active"}})
    assert (await comm.receive_json_from()) == {"type": "ack", "id": 7, "ok": True, "data": {}}
    # Frames without an id get no ack.
    await comm.send_json_to({"type": "app.state", "data": {"state": "active"}})
    await comm.send_json_to({"type": "does.not.exist"})
    assert await comm.receive_nothing(timeout=0.2)
    await comm.disconnect()


# --- messaging --------------------------------------------------------------------------
async def test_message_fanout_to_both_users_and_other_devices():
    a, b, conv_id = await setup_pair()
    a2 = await adb(Login)(a.user)  # Alice's second device
    ca, ca2, cb = (
        await ws_connect(a.access),
        await ws_connect(a2.access),
        await ws_connect(b.access),
    )
    client_id = str(uuid.uuid4())
    ack = await request(
        ca, "message.send", {"conversation_id": conv_id, "client_id": client_id, "body": " hi 👋 "}
    )
    assert ack["ok"] is True
    msg = ack["data"]["message"]
    assert msg["seq"] == 1 and msg["body"] == "hi 👋" and msg["client_id"] == client_id
    for comm in (ca, ca2, cb):
        frame = await recv_type(comm, "message.new")
        assert frame == {"type": "message.new", "data": {"message": msg}}

    # Idempotent retry: same message, no second fan-out.
    ack2 = await request(
        ca,
        "message.send",
        {"conversation_id": conv_id, "client_id": client_id, "body": "hi 👋"},
        "r2",
    )
    assert ack2["data"]["message"] == msg
    assert await cb.receive_nothing(timeout=0.2)

    # Non-members are rejected.
    eve = await adb(Login)(await adb(make_user)("eve"))
    ce = await ws_connect(eve.access)
    ack = await request(
        ce,
        "message.send",
        {"conversation_id": conv_id, "client_id": str(uuid.uuid4()), "body": "x"},
    )
    assert ack["error"]["code"] == "not_found"
    ack = await request(ce, "typing", {"conversation_id": conv_id, "state": "start"}, "t")
    assert ack["error"]["code"] == "not_found"
    for comm in (ca, ca2, cb, ce):
        await comm.disconnect()


async def test_message_send_validation_and_rate_limit(settings):
    settings.RATE_LIMITS = {**settings.RATE_LIMITS, "message_burst": "2/10"}
    a, _, conv_id = await setup_pair()
    ca = await ws_connect(a.access)
    ack = await request(
        ca,
        "message.send",
        {"conversation_id": conv_id, "client_id": str(uuid.uuid4()), "body": " "},
    )
    assert ack["error"]["code"] == "validation_error"
    for i in range(2):
        ack = await request(
            ca,
            "message.send",
            {"conversation_id": conv_id, "client_id": str(uuid.uuid4()), "body": "x"},
            f"m{i}",
        )
        assert ack["ok"]
    ack = await request(
        ca,
        "message.send",
        {"conversation_id": conv_id, "client_id": str(uuid.uuid4()), "body": "x"},
        "m9",
    )
    assert ack["error"]["code"] == "rate_limited"
    assert ack["error"]["retry_after_sec"] >= 1
    await ca.disconnect()


async def test_receipts_are_broadcast():
    a, b, conv_id = await setup_pair()
    ca, cb = await ws_connect(a.access), await ws_connect(b.access)
    for i in range(3):
        await request(
            ca,
            "message.send",
            {"conversation_id": conv_id, "client_id": str(uuid.uuid4()), "body": "x"},
            f"s{i}",
        )
    await drain(cb)
    await drain(ca)
    ack = await request(cb, "message.delivered", {"conversation_id": conv_id, "seq": 3}, "d")
    assert ack["ok"]
    receipt = await recv_type(ca, "message.receipt")
    assert receipt["data"] == {
        "conversation_id": conv_id,
        "user_id": str(b.user.id),
        "delivered_seq": 3,
        "read_seq": 0,
    }
    await request(cb, "message.read", {"conversation_id": conv_id, "seq": 2}, "rd")
    receipt = await recv_type(ca, "message.receipt")
    assert receipt["data"]["read_seq"] == 2 and receipt["data"]["delivered_seq"] == 3
    # A regression produces no receipt.
    await drain(ca)
    await request(cb, "message.read", {"conversation_id": conv_id, "seq": 1}, "rd2")
    assert await ca.receive_nothing(timeout=0.2)
    await ca.disconnect()
    await cb.disconnect()


async def test_typing_relayed_only_to_peer():
    a, b, conv_id = await setup_pair()
    a2 = await adb(Login)(a.user)
    ca, ca2, cb = (
        await ws_connect(a.access),
        await ws_connect(a2.access),
        await ws_connect(b.access),
    )
    await drain(ca)
    await drain(ca2)
    await drain(cb)
    await ca.send_json_to(
        {"type": "typing", "data": {"conversation_id": conv_id, "state": "start"}}
    )
    frame = await recv_type(cb, "typing")
    assert frame["data"] == {
        "conversation_id": conv_id,
        "user_id": str(a.user.id),
        "state": "start",
    }
    assert await ca2.receive_nothing(timeout=0.2)
    assert await ca.receive_nothing(timeout=0.1)
    for comm in (ca, ca2, cb):
        await comm.disconnect()


async def test_presence_online_background_offline():
    a, b, _ = await setup_pair()
    stranger = await adb(Login)(await adb(make_user)("stranger"))
    cb = await ws_connect(b.access)
    ack = await request(
        cb, "presence.subscribe", {"user_ids": [str(a.user.id), str(stranger.user.id)]}
    )
    assert ack["data"]["presence"] == [
        {"user_id": str(a.user.id), "online": False, "last_seen_at": None}
    ]

    # The stranger's presence is never delivered (no shared conversation).
    cs = await ws_connect(stranger.access)
    ca = await ws_connect(a.access)
    frame = await recv_type(cb, "presence")
    assert frame["data"]["user_id"] == str(a.user.id) and frame["data"]["online"] is True

    await ca.send_json_to({"type": "app.state", "data": {"state": "background"}})
    frame = await recv_type(cb, "presence")
    assert frame["data"]["online"] is False and frame["data"]["last_seen_at"]

    await ca.send_json_to({"type": "app.state", "data": {"state": "active"}})
    assert (await recv_type(cb, "presence"))["data"]["online"] is True

    # A second device does not produce a duplicate "online"; closing one keeps Alice online.
    a2 = await adb(Login)(a.user)
    ca2 = await ws_connect(a2.access)
    await ca2.disconnect()
    assert await cb.receive_nothing(timeout=0.2)
    await ca.disconnect()
    frame = await recv_type(cb, "presence")
    assert frame["data"]["online"] is False
    await cs.disconnect()
    await cb.disconnect()


async def test_ping_flow_and_rate_limit():
    a, b, conv_id = await setup_pair()
    ca, cb = await ws_connect(a.access), await ws_connect(b.access)
    ack = await request(
        ca, "ping.send", {"conversation_id": conv_id, "client_id": str(uuid.uuid4())}
    )
    assert ack["ok"] and ack["data"]["message"]["kind"] == "ping"
    received = await recv_type(cb, "ping.received")
    assert received["data"]["message"]["id"] == ack["data"]["message"]["id"]
    assert received["data"]["from"]["id"] == str(a.user.id)
    assert "email" not in received["data"]["from"]
    ack = await request(
        ca, "ping.send", {"conversation_id": conv_id, "client_id": str(uuid.uuid4())}, "p2"
    )
    assert ack["error"]["code"] == "rate_limited" and ack["error"]["retry_after_sec"] >= 1
    await ca.disconnect()
    await cb.disconnect()


async def test_rate_limit_abuse_closes_4008(settings):
    settings.WS_ABUSE_CLOSE_THRESHOLD = 3
    settings.RATE_LIMITS = {**settings.RATE_LIMITS, "typing": "1/60"}
    a, _, conv_id = await setup_pair()
    ca = await ws_connect(a.access)
    for i in range(4):
        await ca.send_json_to(
            {
                "type": "typing",
                "id": f"t{i}",
                "data": {"conversation_id": conv_id, "state": "start"},
            }
        )
    assert await closed_with(ca) == 4008


async def test_session_revocation_closes_socket():
    user = await adb(make_user)("arjun")
    phone, tablet = await adb(Login)(user), await adb(Login)(user)
    cp, ct = await ws_connect(phone.access), await ws_connect(tablet.access)
    r = await adb(phone.client.delete)(f"/api/v1/auth/sessions/{tablet.session.id}")
    assert r.status_code == 204
    frame = await recv_type(ct, "session.revoked")
    assert frame == {"type": "session.revoked", "data": {}}
    assert await closed_with(ct) == 4004
    await cp.send_json_to({"type": "hb"})
    assert await cp.receive_json_from() == {"type": "hb"}
    await cp.disconnect()


async def test_rest_send_fans_out_over_ws():
    a, b, conv_id = await setup_pair()
    cb = await ws_connect(b.access)
    r = await adb(a.client.post)(
        f"/api/v1/conversations/{conv_id}/messages",
        {"client_id": str(uuid.uuid4()), "body": "via rest"},
        format="json",
    )
    assert r.status_code == 201
    frame = await recv_type(cb, "message.new")
    assert frame["data"]["message"]["body"] == "via rest"
    await cb.disconnect()


async def test_reauth_on_open_socket():
    user = await adb(make_user)("arjun")
    login = await adb(Login)(user)
    comm = await ws_connect(login.access)
    ack = await request(comm, "auth", {"token": login.access}, "again")
    assert ack["ok"] and ack["data"]["session_id"] == str(login.session.id)
    other = await adb(Login)(user)
    ack = await request(comm, "auth", {"token": other.access}, "other")
    assert ack["error"]["code"] == "forbidden"
    await comm.disconnect()
    await asyncio.sleep(0)
