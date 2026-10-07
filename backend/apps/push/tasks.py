"""Celery tasks that fan out and deliver pushes.

Fan-out tasks resolve recipients/tokens and enqueue one ``deliver_push`` per token, so a
retry only re-sends to the token that failed. A Redis de-duplication key makes re-runs
idempotent. Tokens and message bodies are never logged.
"""

from __future__ import annotations

import time
from collections import defaultdict
from datetime import timedelta
from typing import Any

from celery import shared_task
from django.conf import settings

from apps.accounts.models import PushProvider, PushToken, User
from apps.calls.models import Call, CallState
from apps.chat.models import Message, MessageKind
from apps.core import metrics
from apps.core.logging import get_logger
from apps.core.redis import get_redis, rkey
from apps.push import payloads
from apps.push.providers import PushMessage, PushResult, get_provider

log = get_logger(__name__)

DEDUPE_TTL_SEC = 24 * 3600


class TransientPushError(Exception):
    """Raised to trigger Celery's retry with exponential backoff."""


def _enqueue(token: PushToken, message: PushMessage, dedupe_key: str) -> None:
    deliver_push.delay(token.id, message.to_dict(), dedupe_key)


@shared_task(ignore_result=True)
def send_message_push(message_id: str, recipient_id: str) -> None:
    from apps.realtime.presence import has_active_connection

    msg = Message.objects.select_related("sender").filter(pk=message_id).first()
    recipient = User.objects.filter(pk=recipient_id, is_active=True).first()
    if msg is None or recipient is None or msg.kind == MessageKind.CALL:
        return
    if has_active_connection(recipient.id):
        return  # the recipient came to the foreground meanwhile
    if msg.kind == MessageKind.PING:
        push = payloads.ping_push(msg, msg.sender)
    else:
        push = payloads.message_push(msg, msg.sender, recipient)
    tokens = PushToken.objects.filter(
        user=recipient, provider__in=[PushProvider.FCM, PushProvider.APNS]
    )
    for token in tokens:
        out = push
        if token.provider == PushProvider.APNS and push.kind == "ping":
            out = payloads.for_apns_alert(push)
        _enqueue(token, out, f"{push.kind}:{message_id}:{token.id}")


@shared_task(ignore_result=True)
def send_call_incoming_push(call_id: str) -> None:
    call = Call.objects.select_related("caller").filter(pk=call_id).first()
    if call is None or call.state != CallState.RINGING:
        return
    expires_at = call.created_at + timedelta(seconds=settings.CALL_RING_TIMEOUT_SEC)
    push = payloads.call_incoming_push(call, call.caller, expires_at)
    by_session: dict[Any, dict[str, PushToken]] = defaultdict(dict)
    for token in PushToken.objects.filter(user_id=call.callee_id):
        by_session[token.session_id][token.provider] = token
    for tokens in by_session.values():
        if fcm := tokens.get(PushProvider.FCM):
            _enqueue(fcm, push, f"call:{call_id}:{fcm.id}")
        if voip := tokens.get(PushProvider.APNS_VOIP):
            voip_push = PushMessage.from_dict(push.to_dict())
            voip_push.voip = True
            _enqueue(voip, voip_push, f"call:{call_id}:{voip.id}")
        elif apns := tokens.get(PushProvider.APNS):
            _enqueue(
                apns,
                payloads.for_apns_alert(push, time_sensitive=True),
                f"call:{call_id}:{apns.id}",
            )


@shared_task(ignore_result=True)
def send_call_ended_push(call_id: str, reason: str, exclude_session: str | None = None) -> None:
    """Tell the callee's devices to stop ringing (never via VoIP: iOS requires a CallKit
    report for every VoIP push, so this goes as a background push)."""
    call = Call.objects.filter(pk=call_id).only("id", "callee_id").first()
    if call is None:
        return
    push = payloads.call_ended_push(str(call.id), reason)
    tokens = PushToken.objects.filter(
        user_id=call.callee_id, provider__in=[PushProvider.FCM, PushProvider.APNS]
    )
    if exclude_session:
        tokens = tokens.exclude(session_id=exclude_session)
    for token in tokens:
        _enqueue(token, push, f"call_ended:{call_id}:{token.id}")


def deliver(token_id: int, message: dict[str, Any], dedupe_key: str) -> PushResult | None:
    """Send one push to one token. Returns ``None`` when there was nothing to do."""
    push = PushMessage.from_dict(message)
    if push.expires_at is not None and time.time() > push.expires_at:
        metrics.PUSH_RESULTS.labels("-", push.kind, "expired").inc()
        return None
    token = PushToken.objects.filter(pk=token_id).first()
    if token is None:
        return None
    redis = get_redis()
    dedupe = rkey("push_sent", dedupe_key)
    if redis.exists(dedupe):
        return PushResult.OK
    result = get_provider(token.provider).send(token.token, push)
    metrics.PUSH_RESULTS.labels(token.provider, push.kind, str(result)).inc()
    log.info(
        "push_delivery",
        provider=token.provider,
        kind=push.kind,
        result=str(result),
        user_id=str(token.user_id),
        token_id=token.id,
    )
    if result == PushResult.OK:
        redis.set(dedupe, "1", ex=DEDUPE_TTL_SEC)
    elif result == PushResult.INVALID_TOKEN:
        PushToken.objects.filter(pk=token.id).delete()
    return result


@shared_task(
    bind=True,
    ignore_result=True,
    autoretry_for=(TransientPushError,),
    retry_backoff=2,
    retry_backoff_max=60,
    retry_jitter=True,
    max_retries=5,
)
def deliver_push(self: Any, token_id: int, message: dict[str, Any], dedupe_key: str) -> None:
    if deliver(token_id, message, dedupe_key) == PushResult.RETRY:
        raise TransientPushError(f"transient failure for token {token_id}")
