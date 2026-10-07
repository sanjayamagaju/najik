from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import time
import uuid

import pytest

from apps.calls import services as call_services
from apps.calls import state as call_state
from apps.calls.ice import ice_servers, turn_credentials
from apps.calls.models import Call
from apps.chat.models import Message
from tests.conftest import (
    Login,
    adb,
    drain,
    make_user,
    recv_type,
    request,
    ws_connect,
)
from tests.test_auth import assert_error

pytestmark = pytest.mark.django_db(transaction=True)

OFFER = {"type": "offer", "sdp": "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n"}


async def users():
    alice = await adb(make_user)("alice", display_name="Alice")
    bob = await adb(make_user)("bob", display_name="Bob")
    return alice, bob


async def invite(comm, callee_id, media="video", call_id=None, frame_id="inv"):
    call_id = call_id or str(uuid.uuid4())
    ack = await request(
        comm,
        "call.invite",
        {"call_id": call_id, "callee_id": str(callee_id), "media": media},
        frame_id,
    )
    return call_id, ack


async def ringing_call():
    """Alice (1 device) calls Bob (2 devices). Returns logins, sockets and call id."""
    alice, bob = await users()
    a, b1, b2 = await adb(Login)(alice), await adb(Login)(bob), await adb(Login)(bob, "ios")
    ca, cb1, cb2 = (
        await ws_connect(a.access),
        await ws_connect(b1.access),
        await ws_connect(b2.access),
    )
    call_id, ack = await invite(ca, bob.id)
    assert ack["ok"], ack
    return a, b1, b2, ca, cb1, cb2, call_id, ack


async def call_log(call_id):
    return await adb(lambda: Message.objects.get(kind="call", meta__call_id=call_id))()


async def test_full_call_flow():
    a, b1, b2, ca, cb1, cb2, call_id, ack = await ringing_call()
    data = ack["data"]
    assert data["call"]["state"] == "ringing" and data["call"]["media"] == "video"
    assert data["call"]["caller_id"] == str(a.user.id)
    assert any("username" in s for s in data["ice_servers"])

    for comm in (cb1, cb2):
        incoming = await recv_type(comm, "call.incoming")
        assert incoming["data"]["call"]["id"] == call_id
        assert incoming["data"]["caller"]["username"] == "alice"
        turn = next(s for s in incoming["data"]["ice_servers"] if "username" in s)
        assert turn["username"].endswith(f":{b1.user.id}")  # credentials for the callee

    assert (await request(cb1, "call.ringing", {"call_id": call_id}, "rg"))["ok"]
    assert (await recv_type(ca, "call.ringing"))["data"] == {"call_id": call_id}

    ack = await request(cb1, "call.accept", {"call_id": call_id}, "acc")
    assert ack["ok"] and ack["data"]["call"]["state"] == "active"
    assert ack["data"]["call"]["answered_at"]
    accepted = await recv_type(ca, "call.accepted")
    assert accepted["data"] == {"call_id": call_id, "session_id": str(b1.session.id)}
    # Bob's other device stops ringing.
    assert (await recv_type(cb2, "call.accepted"))["data"]["session_id"] == str(b1.session.id)
    ended = await recv_type(cb2, "call.ended")
    assert ended["data"] == {"call_id": call_id, "reason": "answered_elsewhere"}
    await drain(cb1)

    # Signals flow between the caller and the bound callee session only.
    assert (await request(ca, "call.signal", {"call_id": call_id, "signal": OFFER}, "s1"))["ok"]
    relayed = await recv_type(cb1, "call.signal")
    assert relayed["data"] == {"call_id": call_id, "signal": OFFER}
    assert await cb2.receive_nothing(timeout=0.2)
    candidate = {
        "type": "candidate",
        "candidate": {
            "candidate": "candidate:1 1 udp 1 1.2.3.4 9 typ host",
            "sdpMid": "0",
            "sdpMLineIndex": 0,
        },
    }
    assert (await request(cb1, "call.signal", {"call_id": call_id, "signal": candidate}, "s2"))[
        "ok"
    ]
    assert (await recv_type(ca, "call.signal"))["data"]["signal"] == candidate
    # The non-bound callee device cannot inject signals.
    ack = await request(cb2, "call.signal", {"call_id": call_id, "signal": OFFER}, "s3")
    assert ack["error"]["code"] == "call_not_found"
    # Invalid signal payloads are rejected.
    ack = await request(ca, "call.signal", {"call_id": call_id, "signal": {"type": "offer"}}, "s4")
    assert ack["error"]["code"] == "validation_error"
    ack = await request(
        ca,
        "call.signal",
        {"call_id": call_id, "signal": {"type": "quality", "video": "4k", "audio": "auto"}},
        "s5",
    )
    assert ack["error"]["code"] == "validation_error"
    quality = {"type": "quality", "video": "360p", "audio": "low"}
    assert (await request(cb1, "call.signal", {"call_id": call_id, "signal": quality}, "s6"))["ok"]
    assert (await recv_type(ca, "call.signal"))["data"]["signal"] == quality

    ack = await request(
        ca,
        "call.media_state",
        {"call_id": call_id, "audio_muted": True, "video_enabled": False},
        "ms",
    )
    assert ack["ok"]
    media = await recv_type(cb1, "call.media_state")
    assert media["data"] == {
        "call_id": call_id,
        "user_id": str(a.user.id),
        "audio_muted": True,
        "video_enabled": False,
    }

    assert (await request(cb1, "call.hangup", {"call_id": call_id}, "hu"))["ok"]
    for comm in (ca, cb1):
        assert (await recv_type(comm, "call.ended"))["data"] == {
            "call_id": call_id,
            "reason": "completed",
        }
    new = await recv_type(ca, "message.new")
    assert new["data"]["message"]["kind"] == "call"
    assert new["data"]["message"]["meta"]["outcome"] == "completed"
    assert new["data"]["message"]["sender_id"] == str(a.user.id)
    call = await adb(Call.objects.get)(pk=call_id)
    assert call.state == "ended" and call.end_reason == "completed"
    # After the call ends, signals are rejected.
    ack = await request(ca, "call.signal", {"call_id": call_id, "signal": OFFER}, "late")
    assert ack["error"]["code"] == "call_not_found"
    # Both users are free again.
    _, ack = await invite(ca, b1.user.id, frame_id="again")
    assert ack["data"]["call"]["state"] == "ringing"
    for comm in (ca, cb1, cb2):
        await comm.disconnect()


async def test_decline():
    a, b1, b2, ca, cb1, cb2, call_id, _ = await ringing_call()
    assert (await request(cb2, "call.decline", {"call_id": call_id}, "dc"))["ok"]
    assert (await recv_type(ca, "call.ended"))["data"]["reason"] == "declined"
    assert (await recv_type(cb1, "call.ended"))["data"]["reason"] == "declined"
    assert (await call_log(call_id)).meta["outcome"] == "declined"
    # A second decline is a no-op error.
    assert (await request(cb1, "call.decline", {"call_id": call_id}, "dc2"))["error"][
        "code"
    ] == "call_not_found"
    for comm in (ca, cb1, cb2):
        await comm.disconnect()


async def test_cancel_by_caller():
    a, b1, b2, ca, cb1, cb2, call_id, _ = await ringing_call()
    assert (await request(ca, "call.hangup", {"call_id": call_id}, "c"))["ok"]
    for comm in (cb1, cb2):
        assert (await recv_type(comm, "call.ended"))["data"]["reason"] == "cancelled"
    log = await call_log(call_id)
    assert log.meta == {
        "call_id": call_id,
        "media": "video",
        "outcome": "cancelled",
        "duration_sec": 0,
    }
    # Accepting a cancelled call fails.
    assert (await request(cb1, "call.accept", {"call_id": call_id}, "late"))["error"][
        "code"
    ] == "call_not_found"
    for comm in (ca, cb1, cb2):
        await comm.disconnect()


async def test_busy():
    a, b1, b2, ca, cb1, cb2, call_id, _ = await ringing_call()
    carol = await adb(Login)(await adb(make_user)("carol"))
    cc = await ws_connect(carol.access)
    busy_id, ack = await invite(cc, b1.user.id, media="audio")
    assert ack["ok"]
    assert ack["data"]["call"]["state"] == "ended" and ack["data"]["call"]["end_reason"] == "busy"
    ended = await recv_type(cc, "call.ended")
    assert ended["data"] == {"call_id": busy_id, "reason": "busy"}
    assert (await call_log(busy_id)).meta["outcome"] == "busy"
    # The caller is busy too.
    _, ack = await invite(cc, a.user.id, frame_id="inv2")
    assert ack["data"]["call"]["end_reason"] == "busy"
    # A caller already in a call cannot start another one.
    _, ack = await invite(ca, carol.user.id, frame_id="inv3")
    assert ack["error"]["code"] == "busy"
    # The original call is unaffected.
    assert (await request(cb1, "call.accept", {"call_id": call_id}, "acc"))["ok"]
    for comm in (ca, cb1, cb2, cc):
        await comm.disconnect()


async def test_invite_validation_and_idempotency():
    alice, bob = await users()
    a = await adb(Login)(alice)
    ca = await ws_connect(a.access)
    _, ack = await invite(ca, alice.id)
    assert ack["error"]["code"] == "validation_error"
    _, ack = await invite(ca, uuid.uuid4(), frame_id="i2")
    assert ack["error"]["code"] == "not_found"
    ack = await request(
        ca,
        "call.invite",
        {"call_id": str(uuid.uuid4()), "callee_id": str(bob.id), "media": "hologram"},
        "i3",
    )
    assert ack["error"]["code"] == "validation_error"
    call_id, ack1 = await invite(ca, bob.id, frame_id="i4")
    _, ack2 = await invite(ca, bob.id, call_id=call_id, frame_id="i5")
    assert ack2["ok"] and ack2["data"]["call"]["id"] == ack1["data"]["call"]["id"]
    assert await adb(Call.objects.count)() == 1
    await ca.disconnect()


async def test_ring_timeout(settings):
    settings.CALL_RING_TIMEOUT_SEC = 0.3
    a, b1, b2, ca, cb1, cb2, call_id, _ = await ringing_call()
    for comm in (ca, cb1, cb2):
        assert (await recv_type(comm, "call.ended", timeout=5))["data"] == {
            "call_id": call_id,
            "reason": "timeout",
        }
    assert (await call_log(call_id)).meta["outcome"] == "missed"
    for comm in (ca, cb1, cb2):
        await comm.disconnect()


async def test_ring_timeout_enforced_by_sweeper():
    """Simulates the node that started the timer dying: the beat sweeper ends the call."""
    from apps.calls.timers import cancel_local_timers

    a, b1, b2, ca, cb1, cb2, call_id, _ = await ringing_call()
    cancel_local_timers()
    assert await adb(call_services.sweep)() == 0  # not due yet
    future = int(time.time() * 1000) + 60_000
    assert await adb(call_services.sweep)(now_ms=future) == 1
    assert (await recv_type(ca, "call.ended"))["data"]["reason"] == "timeout"
    assert await adb(call_services.sweep)(now_ms=future) == 0  # idempotent
    for comm in (ca, cb1, cb2):
        await comm.disconnect()


async def _active_call():
    a, b1, b2, ca, cb1, cb2, call_id, _ = await ringing_call()
    assert (await request(cb1, "call.accept", {"call_id": call_id}, "acc"))["ok"]
    await cb2.disconnect()
    await drain(ca)
    await drain(cb1)
    return a, b1, ca, cb1, call_id


async def test_reconnect_within_grace_keeps_call(settings):
    settings.CALL_RECONNECT_GRACE_SEC = 0.6
    a, b1, ca, cb1, call_id = await _active_call()
    await cb1.disconnect()
    await asyncio.sleep(0.2)
    cb1 = await ws_connect(b1.access)  # same session reconnects
    await asyncio.sleep(0.8)
    call = await adb(Call.objects.get)(pk=call_id)
    assert call.state == "active"
    assert (await request(ca, "call.signal", {"call_id": call_id, "signal": OFFER}, "ice"))["ok"]
    assert (await recv_type(cb1, "call.signal"))["data"]["signal"] == OFFER
    await ca.disconnect()
    await cb1.disconnect()


async def test_grace_expiry_ends_call_failed(settings):
    settings.CALL_RECONNECT_GRACE_SEC = 0.3
    a, b1, ca, cb1, call_id = await _active_call()
    await cb1.disconnect()
    ended = await recv_type(ca, "call.ended", timeout=5)
    assert ended["data"] == {"call_id": call_id, "reason": "failed"}
    assert (await call_log(call_id)).meta["outcome"] == "failed"
    await ca.disconnect()


async def test_non_participant_cannot_signal_or_hangup():
    a, b1, ca, cb1, call_id = await _active_call()
    eve = await adb(Login)(await adb(make_user)("eve"))
    ce = await ws_connect(eve.access)
    for frame_type, data in (
        ("call.signal", {"call_id": call_id, "signal": OFFER}),
        ("call.media_state", {"call_id": call_id, "audio_muted": False, "video_enabled": True}),
        ("call.hangup", {"call_id": call_id}),
        ("call.accept", {"call_id": call_id}),
        ("call.ringing", {"call_id": call_id}),
    ):
        ack = await request(ce, frame_type, data, frame_type)
        assert ack["error"]["code"] == "call_not_found", frame_type
    ack = await request(ce, "call.signal", {"call_id": str(uuid.uuid4()), "signal": OFFER}, "u")
    assert ack["error"]["code"] == "call_not_found"
    assert await cb1.receive_nothing(timeout=0.2)
    for comm in (ca, cb1, ce):
        await comm.disconnect()


async def test_oversized_signal_rejected():
    a, b1, ca, cb1, call_id = await _active_call()
    big = {"type": "offer", "sdp": "x" * (16 * 1024)}
    ack = await request(ca, "call.signal", {"call_id": call_id, "signal": big}, "big")
    assert ack["error"]["code"] == "validation_error"
    await ca.disconnect()
    await cb1.disconnect()


async def test_call_rest_endpoints():
    a, b1, ca, cb1, call_id = await _active_call()
    await request(ca, "call.hangup", {"call_id": call_id}, "hu")
    eve = await adb(Login)(await adb(make_user)("eve"))

    r = await adb(a.client.get)(f"/api/v1/calls/{call_id}")
    assert r.status_code == 200 and r.json()["end_reason"] == "completed"
    assert_error(await adb(eve.client.get)(f"/api/v1/calls/{call_id}"), 404, "not_found")

    r = await adb(b1.client.get)("/api/v1/calls")
    results = r.json()["results"]
    assert len(results) == 1 and results[0]["peer"]["id"] == str(a.user.id)
    assert r.json()["next_cursor"] is None

    metrics = {
        "rtt_ms_avg": 80.5,
        "jitter_ms_avg": 4,
        "packet_loss_pct_avg": 0.4,
        "bitrate_kbps_avg_up": 900,
        "bitrate_kbps_avg_down": 850,
        "video_quality_changes": 2,
        "reconnects": 1,
        "duration_sec": 63,
        "network_type": "wifi",
        "selected_video_quality": "auto",
        "selected_audio_quality": "auto",
    }
    r = await adb(a.client.post)(f"/api/v1/calls/{call_id}/metrics", metrics, format="json")
    assert r.status_code == 202
    r = await adb(a.client.post)(
        f"/api/v1/calls/{call_id}/metrics", {**metrics, "rtt_ms_avg": -1}, format="json"
    )
    assert_error(r, 400, "validation_error")
    r = await adb(eve.client.post)(f"/api/v1/calls/{call_id}/metrics", metrics, format="json")
    assert_error(r, 404, "not_found")
    await ca.disconnect()
    await cb1.disconnect()


def test_turn_credentials(settings):
    user_id = uuid.uuid4()
    username, credential = turn_credentials(user_id, now=1_700_000_000)
    assert username == f"{1_700_000_000 + 3600}:{user_id}"
    expected = base64.b64encode(
        hmac.new(b"test-turn-secret", username.encode(), hashlib.sha1).digest()
    ).decode()
    assert credential == expected
    servers = ice_servers(user_id)
    assert servers["ttl_sec"] == 3600
    assert servers["ice_servers"][0] == {"urls": ["stun:turn.example.com:3478"]}
    assert servers["ice_servers"][1]["urls"] == settings.TURN_URLS


@pytest.mark.django_db
def test_ice_servers_endpoint():
    login = Login(make_user("arjun"))
    r = login.client.get("/api/v1/calls/ice-servers")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"ice_servers", "ttl_sec"}
    assert body["ice_servers"][1]["username"].endswith(str(login.user.id))


async def test_stale_busy_claim_is_taken_over():
    alice, bob = await users()
    await adb(call_state.claim_user)(bob.id, uuid.uuid4())  # claim for a call that is not live
    a = await adb(Login)(alice)
    ca = await ws_connect(a.access)
    _, ack = await invite(ca, bob.id)
    assert ack["data"]["call"]["state"] == "ringing"
    await ca.disconnect()
