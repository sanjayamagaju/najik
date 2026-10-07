from __future__ import annotations

import time
import uuid
from datetime import timedelta

import httpx
import pytest
from django.utils import timezone

from apps.accounts.models import PushToken
from apps.calls.models import Call
from apps.chat import services as chat_services
from apps.push import payloads, tasks
from apps.push.providers import PushMessage, PushResult
from apps.push.providers.apns import APNsProvider
from apps.push.providers.fcm import FCMProvider
from tests.conftest import Login, adb, make_user, recv_type, request, ws_connect

pytestmark = pytest.mark.django_db


class Recorder:
    def __init__(self, result=PushResult.OK):
        self.sent: list[tuple[str, str, PushMessage]] = []
        self.result = result

    def __call__(self, name):
        recorder = self

        class _P:
            def __init__(self):
                self.name = name

            def send(self, token, message):
                recorder.sent.append((name, token, message))
                return recorder.result

        return _P()


@pytest.fixture
def recorder(monkeypatch):
    rec = Recorder()
    monkeypatch.setattr(tasks, "get_provider", rec)
    return rec


def add_token(login, provider, token=None):
    return PushToken.objects.create(
        session=login.session,
        user=login.user,
        provider=provider,
        token=token or f"{provider}-{uuid.uuid4().hex}",
    )


def make_pair():
    a, b = Login(make_user("alice", display_name="Alice")), Login(make_user("bob"))
    conv, _ = chat_services.get_or_create_conversation(a.user, b.user.id)
    return a, b, conv


def test_message_push_when_recipient_offline(recorder):
    a, b, conv = make_pair()
    add_token(b, "fcm")
    add_token(b, "apns")
    add_token(b, "apns_voip")
    r = a.client.post(
        f"/api/v1/conversations/{conv.id}/messages",
        {"client_id": str(uuid.uuid4()), "body": "secret plans"},
        format="json",
    )
    assert r.status_code == 201
    kinds = sorted(name for name, _, _ in recorder.sent)
    assert kinds == ["apns", "fcm"]  # never over VoIP
    message = recorder.sent[0][2]
    assert message.data["type"] == "message"
    assert message.data["preview"] == "secret plans"
    assert message.data["sender_name"] == "Alice"
    assert message.collapse_id == str(conv.id) and message.thread_id == str(conv.id)


def test_message_preview_hidden_by_setting(recorder):
    a, b, conv = make_pair()
    b.user.show_message_preview = False
    b.user.save()
    add_token(b, "fcm")
    a.client.post(
        f"/api/v1/conversations/{conv.id}/messages",
        {"client_id": str(uuid.uuid4()), "body": "secret"},
        format="json",
    )
    message = recorder.sent[0][2]
    assert message.data["preview"] == "" and message.body == "New message"


def test_ping_push_payload(recorder):
    a, b, conv = make_pair()
    add_token(b, "fcm")
    add_token(b, "apns")
    a.client.post(
        f"/api/v1/conversations/{conv.id}/ping", {"client_id": str(uuid.uuid4())}, format="json"
    )
    by_provider = {name: msg for name, _, msg in recorder.sent}
    assert by_provider["fcm"].data == {
        "type": "ping",
        "conversation_id": str(conv.id),
        "sender_name": "Alice",
    }
    assert by_provider["fcm"].title is None  # data-only on Android
    assert by_provider["apns"].title == "Alice"  # alert on iOS


@pytest.mark.django_db(transaction=True)
async def test_no_message_push_when_recipient_active(monkeypatch):
    rec = Recorder()
    monkeypatch.setattr(tasks, "get_provider", rec)
    a, b, conv = await adb(make_pair)()
    await adb(add_token)(b, "fcm")
    cb = await ws_connect(b.access)
    ca = await ws_connect(a.access)
    await request(
        ca,
        "message.send",
        {"conversation_id": str(conv.id), "client_id": str(uuid.uuid4()), "body": "x"},
    )
    await recv_type(cb, "message.new")
    assert rec.sent == []
    await cb.send_json_to({"type": "app.state", "id": "bg", "data": {"state": "background"}})
    await recv_type(cb, "ack")
    await request(
        ca,
        "message.send",
        {"conversation_id": str(conv.id), "client_id": str(uuid.uuid4()), "body": "y"},
        "m2",
    )
    await recv_type(cb, "message.new")
    assert len(rec.sent) == 1
    await ca.disconnect()
    await cb.disconnect()


@pytest.mark.django_db(transaction=True)
async def test_call_pushes(monkeypatch):
    rec = Recorder()
    monkeypatch.setattr(tasks, "get_provider", rec)
    a, b, _ = await adb(make_pair)()
    b_ios = await adb(Login)(b.user, "ios")
    b_ios_novoip = await adb(Login)(b.user, "ios")
    await adb(add_token)(b, "fcm")
    await adb(add_token)(b_ios, "apns")
    await adb(add_token)(b_ios, "apns_voip")
    await adb(add_token)(b_ios_novoip, "apns")
    ca = await ws_connect(a.access)
    call_id = str(uuid.uuid4())
    ack = await request(
        ca, "call.invite", {"call_id": call_id, "callee_id": str(b.user.id), "media": "audio"}
    )
    assert ack["ok"]
    sent = {(name, msg.voip, msg.time_sensitive) for name, _, msg in rec.sent}
    assert sent == {("fcm", False, False), ("apns_voip", True, False), ("apns", False, True)}
    incoming = rec.sent[0][2]
    assert incoming.data["type"] == "call.incoming" and incoming.data["call_id"] == call_id
    assert incoming.data["caller_name"] == "Alice" and incoming.data["media"] == "audio"
    assert incoming.data["expires_at"].endswith("Z")
    assert incoming.ttl_sec == 45

    rec.sent.clear()
    await request(ca, "call.hangup", {"call_id": call_id}, "c")
    ended = {
        (name, msg.data["type"], msg.data["reason"], msg.background) for name, _, msg in rec.sent
    }
    assert ended == {
        ("fcm", "call.ended", "cancelled", True),
        ("apns", "call.ended", "cancelled", True),
    }
    await ca.disconnect()


def test_invalid_token_is_deleted_and_dedupe(monkeypatch):
    a, b, conv = make_pair()
    token = add_token(b, "fcm")
    rec = Recorder(PushResult.INVALID_TOKEN)
    monkeypatch.setattr(tasks, "get_provider", rec)
    msg = PushMessage(kind="message", data={"type": "message"})
    assert tasks.deliver(token.id, msg.to_dict(), "k1") == PushResult.INVALID_TOKEN
    assert not PushToken.objects.filter(pk=token.id).exists()

    token = add_token(b, "fcm")
    rec.result = PushResult.OK
    assert tasks.deliver(token.id, msg.to_dict(), "k2") == PushResult.OK
    assert tasks.deliver(token.id, msg.to_dict(), "k2") == PushResult.OK
    assert len(rec.sent) == 2  # the duplicate was not re-sent (1 invalid + 1 ok)

    rec.result = PushResult.RETRY
    assert tasks.deliver(token.id, msg.to_dict(), "k3") == PushResult.RETRY
    expired = PushMessage(kind="call.incoming", data={}, expires_at=time.time() - 1)
    assert tasks.deliver(token.id, expired.to_dict(), "k4") is None


def test_log_only_provider_used_in_tests():
    a, b, conv = make_pair()
    token = add_token(b, "apns_voip")
    msg = PushMessage(kind="call.incoming", data={"type": "call.incoming"}, voip=True)
    assert tasks.deliver(token.id, msg.to_dict(), "x") == PushResult.OK


def test_fcm_build_and_classify():
    msg = payloads.call_ended_push("c1", "timeout")
    body = FCMProvider.build("tok", msg)["message"]
    assert body["token"] == "tok" and body["data"]["type"] == "call.ended"
    assert body["android"]["priority"] == "HIGH" and body["android"]["ttl"] == "60s"
    assert "notification" not in body["android"]

    note = PushMessage(
        kind="message",
        data={"type": "message"},
        title="A",
        body="hi",
        collapse_id="conv",
        android_channel="messages",
    )
    android = FCMProvider.build("tok", note)["message"]["android"]
    assert android["notification"] == {
        "title": "A",
        "body": "hi",
        "tag": "conv",
        "channel_id": "messages",
    }

    def resp(status, payload=None):
        return httpx.Response(status, json=payload or {})

    unregistered = {
        "error": {
            "status": "NOT_FOUND",
            "details": [
                {
                    "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
                    "errorCode": "UNREGISTERED",
                }
            ],
        }
    }
    assert FCMProvider.classify(resp(200)) == PushResult.OK
    assert FCMProvider.classify(resp(404, unregistered)) == PushResult.INVALID_TOKEN
    assert FCMProvider.classify(resp(400, {"error": {"status": "INVALID_ARGUMENT"}})) == (
        PushResult.INVALID_TOKEN
    )
    assert FCMProvider.classify(resp(503)) == PushResult.RETRY
    assert FCMProvider.classify(resp(429)) == PushResult.RETRY
    assert FCMProvider.classify(resp(403, {"error": {"status": "PERMISSION_DENIED"}})) == (
        PushResult.FAILED
    )


def test_apns_build_and_classify(settings):
    settings.APNS_BUNDLE_ID = "com.najik.app"
    voip = PushMessage(
        kind="call.incoming",
        data={"type": "call.incoming", "call_id": "c"},
        voip=True,
        expires_at=1_900_000_000,
        collapse_id="call-c",
    )
    headers, payload = APNsProvider.build(voip)
    assert headers["apns-push-type"] == "voip" and headers["apns-topic"] == "com.najik.app.voip"
    assert headers["apns-priority"] == "10" and headers["apns-expiration"] == "1900000000"
    assert payload == {"type": "call.incoming", "call_id": "c"}

    background = payloads.call_ended_push("c", "declined")
    headers, payload = APNsProvider.build(background)
    assert headers["apns-push-type"] == "background" and headers["apns-priority"] == "5"
    assert payload["aps"] == {"content-available": 1}

    alert = PushMessage(
        kind="message", data={"type": "message"}, title="A", body="hi", thread_id="conv"
    )
    headers, payload = APNsProvider.build(alert)
    assert headers["apns-push-type"] == "alert" and headers["apns-topic"] == "com.najik.app"
    assert payload["aps"]["alert"] == {"title": "A", "body": "hi"}
    assert payload["aps"]["thread-id"] == "conv"

    def resp(status, reason=None):
        return httpx.Response(status, json={"reason": reason} if reason else {})

    assert APNsProvider.classify(resp(200)) == PushResult.OK
    assert APNsProvider.classify(resp(410, "Unregistered")) == PushResult.INVALID_TOKEN
    assert APNsProvider.classify(resp(400, "BadDeviceToken")) == PushResult.INVALID_TOKEN
    assert APNsProvider.classify(resp(429, "TooManyRequests")) == PushResult.RETRY
    assert APNsProvider.classify(resp(400, "PayloadTooLarge")) == PushResult.FAILED


def test_apns_provider_signs_es256_jwt(settings, monkeypatch):
    import jwt
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    settings.APNS_PRIVATE_KEY = pem
    settings.APNS_TEAM_ID = "TEAM123456"
    settings.APNS_KEY_ID = "KEY1234567"
    settings.APNS_BUNDLE_ID = "com.najik.app"
    provider = APNsProvider()
    seen = {}

    def fake_post(url, json, headers):
        seen.update(url=url, headers=headers, json=json)
        return httpx.Response(200)

    monkeypatch.setattr(provider._client, "post", fake_post)
    msg = PushMessage(kind="call.incoming", data={"type": "call.incoming"}, voip=True)
    assert provider.send("abc123", msg) == PushResult.OK
    assert seen["url"].endswith("/3/device/abc123")
    token = seen["headers"]["authorization"].split()[1]
    assert jwt.get_unverified_header(token)["kid"] == "KEY1234567"
    claims = jwt.decode(token, key.public_key(), algorithms=["ES256"])
    assert claims["iss"] == "TEAM123456"


def test_call_incoming_push_skipped_when_not_ringing(recorder):
    a, b, conv = make_pair()
    add_token(b, "fcm")
    call = Call.objects.create(
        id=uuid.uuid4(),
        conversation=conv,
        caller=a.user,
        callee=b.user,
        media="audio",
        state="ended",
        end_reason="cancelled",
        ended_at=timezone.now() - timedelta(seconds=1),
    )
    tasks.send_call_incoming_push(str(call.id))
    assert recorder.sent == []
