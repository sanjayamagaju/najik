"""Push payloads (PROTOCOL.md §5). All pushes are data-first."""

from __future__ import annotations

import time
from datetime import datetime

from django.conf import settings

from apps.accounts.models import User
from apps.calls.models import Call
from apps.chat.models import Message
from apps.core.utils import iso
from apps.push.providers.base import PushMessage

PREVIEW_CHARS = 140


def _preview(body: str) -> str:
    flat = " ".join(body.split())
    return flat if len(flat) <= PREVIEW_CHARS else flat[: PREVIEW_CHARS - 1] + "…"


def message_push(msg: Message, sender: User, recipient: User) -> PushMessage:
    preview = _preview(msg.body) if recipient.show_message_preview else ""
    conversation_id = str(msg.conversation_id)
    return PushMessage(
        kind="message",
        data={
            "type": "message",
            "conversation_id": conversation_id,
            "message_id": str(msg.id),
            "sender_name": sender.display_name,
            "preview": preview,
        },
        title=sender.display_name,
        body=preview or "New message",
        collapse_id=conversation_id,
        thread_id=conversation_id,
        android_channel=settings.FCM_ANDROID_CHANNEL_MESSAGES,
        ttl_sec=7 * 24 * 3600,
    )


def ping_push(msg: Message, sender: User) -> PushMessage:
    conversation_id = str(msg.conversation_id)
    return PushMessage(
        kind="ping",
        data={
            "type": "ping",
            "conversation_id": conversation_id,
            "sender_name": sender.display_name,
        },
        # Android: data-only (the app presents it). iOS: alert built from title/body.
        title=None,
        body=None,
        thread_id=conversation_id,
        android_channel=settings.FCM_ANDROID_CHANNEL_PINGS,
        ttl_sec=3600,
        extra={"apns_title": sender.display_name, "apns_body": "Pinged you"},
    )


def call_incoming_push(call: Call, caller: User, expires_at: datetime) -> PushMessage:
    return PushMessage(
        kind="call.incoming",
        data={
            "type": "call.incoming",
            "call_id": str(call.id),
            "caller_id": str(caller.id),
            "caller_name": caller.display_name,
            "media": call.media,
            "expires_at": iso(expires_at) or "",
        },
        ttl_sec=int(settings.CALL_RING_TIMEOUT_SEC),
        expires_at=expires_at.timestamp(),
        collapse_id=f"call-{call.id}",
        extra={
            "apns_title": caller.display_name,
            "apns_body": f"Incoming {call.media} call",
        },
    )


def call_ended_push(call_id: str, reason: str) -> PushMessage:
    return PushMessage(
        kind="call.ended",
        data={"type": "call.ended", "call_id": call_id, "reason": reason},
        ttl_sec=60,
        expires_at=time.time() + 60,
        background=True,
        collapse_id=f"call-{call_id}",
    )


def for_apns_alert(message: PushMessage, *, time_sensitive: bool = False) -> PushMessage:
    """Turn a data-only push into an APNs alert using the ``apns_title``/``apns_body`` hints."""
    copy = PushMessage.from_dict(message.to_dict())
    copy.title = copy.extra.get("apns_title", copy.title)
    copy.body = copy.extra.get("apns_body", copy.body)
    copy.time_sensitive = time_sensitive
    copy.background = False
    copy.voip = False
    return copy
