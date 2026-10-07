"""Conversation and message operations (shared by REST and WebSocket transports).

Concurrency model (PostgreSQL):
- ``seq`` is assigned while holding ``SELECT ... FOR UPDATE`` on the conversation row, so
  sends to one conversation serialise and sequence numbers are gap-free.
- Idempotency is checked *after* taking the lock, so concurrent retries of one ``client_id``
  observe the first insert; the ``(sender, client_id)`` unique constraint is the backstop.
- ``unread_count`` and ``read_seq`` only change under the same lock.
- Watermarks only move forward (conditional ``UPDATE ... WHERE x < new``).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import F, Q
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.presenters import public_user
from apps.chat import presenters
from apps.chat.models import Conversation, ConversationMember, Message, MessageKind
from apps.core import metrics
from apps.core.errors import Conflict, NotFound, validation_error
from apps.core.logging import get_logger
from apps.realtime.events import Event, emit_sync, user_group

log = get_logger(__name__)

MAX_BODY_CHARS = 4000


# ----------------------------------------------------------------------------------------
# Conversations
# ----------------------------------------------------------------------------------------
def ordered_pair(a: uuid.UUID, b: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    return (a, b) if a < b else (b, a)


def get_or_create_conversation(user: User, peer_id: uuid.UUID) -> tuple[Conversation, bool]:
    if peer_id == user.id:
        raise validation_error("user_id", "You cannot start a conversation with yourself.")
    peer = User.objects.filter(pk=peer_id, is_active=True).first()
    if peer is None:
        raise NotFound("User not found.")
    return _get_or_create_pair(user.id, peer.id)


def _get_or_create_pair(a: uuid.UUID, b: uuid.UUID) -> tuple[Conversation, bool]:
    low, high = ordered_pair(a, b)
    existing = Conversation.objects.filter(user_low_id=low, user_high_id=high).first()
    if existing:
        return existing, False
    try:
        with transaction.atomic():
            conv = Conversation.objects.create(user_low_id=low, user_high_id=high)
            ConversationMember.objects.bulk_create(
                [
                    ConversationMember(conversation=conv, user_id=low, peer_id=high),
                    ConversationMember(conversation=conv, user_id=high, peer_id=low),
                ]
            )
    except IntegrityError:
        return Conversation.objects.get(user_low_id=low, user_high_id=high), False
    log.info("conversation_created", conversation_id=str(conv.id))
    return conv, True


def get_membership(user_id: uuid.UUID, conversation_id: uuid.UUID) -> ConversationMember:
    """The caller's membership, or 404 (non-members cannot learn the conversation exists)."""
    member = (
        ConversationMember.objects.select_related(
            "conversation", "conversation__last_message", "peer"
        )
        .filter(conversation_id=conversation_id, user_id=user_id)
        .first()
    )
    if member is None:
        raise NotFound("Conversation not found.")
    return member


def peer_member(member: ConversationMember) -> ConversationMember | None:
    return ConversationMember.objects.filter(
        conversation_id=member.conversation_id, user_id=member.peer_id
    ).first()


def conversation_payload(user_id: uuid.UUID, conversation_id: uuid.UUID) -> dict[str, Any]:
    mine = get_membership(user_id, conversation_id)
    return presenters.conversation(mine, peer_member(mine))


def conversation_payloads(members: list[ConversationMember]) -> list[dict[str, Any]]:
    if not members:
        return []
    peers = {
        (m.conversation_id, m.user_id): m
        for m in ConversationMember.objects.filter(
            conversation_id__in=[m.conversation_id for m in members]
        )
    }
    return [presenters.conversation(m, peers.get((m.conversation_id, m.peer_id))) for m in members]


def shared_peer_ids(user_id: uuid.UUID, candidate_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """Subset of ``candidate_ids`` the user shares a conversation with."""
    if not candidate_ids:
        return set()
    return set(
        ConversationMember.objects.filter(user_id=user_id, peer_id__in=candidate_ids).values_list(
            "peer_id", flat=True
        )
    )


# ----------------------------------------------------------------------------------------
# Messages
# ----------------------------------------------------------------------------------------
@dataclass(slots=True)
class SendResult:
    message: Message
    created: bool
    peer_id: uuid.UUID


def _insert_message(
    conv: Conversation,
    *,
    sender_id: uuid.UUID,
    client_id: uuid.UUID,
    kind: str,
    body: str,
    meta: dict[str, Any] | None,
) -> Message:
    """Append a message to a *locked* conversation row."""
    now = timezone.now()
    seq = conv.last_seq + 1
    msg = Message.objects.create(
        conversation=conv,
        sender_id=sender_id,
        client_id=client_id,
        seq=seq,
        kind=kind,
        body=body,
        meta=meta or {},
        created_at=now,
    )
    Conversation.objects.filter(pk=conv.pk).update(last_seq=seq, last_message=msg, updated_at=now)
    conv.last_seq, conv.last_message, conv.updated_at = seq, msg, now
    ConversationMember.objects.filter(conversation=conv).update(sort_at=now, has_messages=True)
    ConversationMember.objects.filter(conversation=conv).exclude(user_id=sender_id).update(
        unread_count=F("unread_count") + 1
    )
    metrics.MESSAGES.labels(kind).inc()
    return msg


def send_message(
    sender: User,
    conversation_id: uuid.UUID,
    client_id: uuid.UUID,
    *,
    kind: str = MessageKind.TEXT,
    body: str = "",
) -> SendResult:
    """Create (or idempotently return) a message from ``sender``."""
    try:
        with transaction.atomic():
            conv = (
                Conversation.objects.select_for_update()
                .filter(pk=conversation_id)
                .filter(Q(user_low_id=sender.id) | Q(user_high_id=sender.id))
                .first()
            )
            if conv is None:
                raise NotFound("Conversation not found.")
            peer_id = conv.user_high_id if conv.user_low_id == sender.id else conv.user_low_id
            existing = Message.objects.filter(sender_id=sender.id, client_id=client_id).first()
            if existing is not None:
                return _existing(existing, conv.id, peer_id, kind)
            msg = _insert_message(
                conv, sender_id=sender.id, client_id=client_id, kind=kind, body=body, meta=None
            )
    except IntegrityError:
        # Concurrent insert of the same client_id into another conversation.
        existing = Message.objects.filter(sender_id=sender.id, client_id=client_id).first()
        if existing is None:
            raise
        conv = existing.conversation
        peer_id = conv.user_high_id if conv.user_low_id == sender.id else conv.user_low_id
        return _existing(existing, conversation_id, peer_id, kind)
    return SendResult(msg, True, peer_id)


def _existing(
    msg: Message, conversation_id: uuid.UUID, peer_id: uuid.UUID, kind: str
) -> SendResult:
    if msg.conversation_id != conversation_id or msg.kind != kind:
        raise Conflict(
            "client_id was already used for a different message.",
            details={"client_id": ["client_id_reused"]},
        )
    return SendResult(msg, False, peer_id)


def append_system_message(
    conversation_id: uuid.UUID,
    *,
    sender_id: uuid.UUID,
    client_id: uuid.UUID,
    kind: str,
    meta: dict[str, Any],
) -> Message | None:
    """Idempotently append a server-generated message (e.g. a call log). Must run in a txn."""
    conv = Conversation.objects.select_for_update().filter(pk=conversation_id).first()
    if conv is None:
        return None
    if Message.objects.filter(sender_id=sender_id, client_id=client_id).exists():
        return None
    return _insert_message(
        conv, sender_id=sender_id, client_id=client_id, kind=kind, body="", meta=meta
    )


def message_events(msg: Message, peer_id: uuid.UUID) -> list[Event]:
    payload = {"message": presenters.message(msg)}
    return [
        Event(user_group(msg.sender_id), "message.new", payload),
        Event(user_group(peer_id), "message.new", payload),
    ]


def publish_new_message(result: SendResult, sender: User) -> None:
    """Fan out ``message.new`` (+ ``ping.received``) and enqueue pushes. Call after commit."""
    if not result.created:
        return
    from apps.push import tasks as push_tasks
    from apps.realtime.presence import has_active_connection

    msg = result.message
    events = message_events(msg, result.peer_id)
    if msg.kind == MessageKind.PING:
        events.append(
            Event(
                user_group(result.peer_id),
                "ping.received",
                {"message": presenters.message(msg), "from": public_user(sender)},
            )
        )
    emit_sync(events)
    log.info(
        "message_created",
        conversation_id=str(msg.conversation_id),
        message_id=str(msg.id),
        sender_id=str(msg.sender_id),
        kind=msg.kind,
        seq=msg.seq,
    )
    try:
        if not has_active_connection(result.peer_id):
            push_tasks.send_message_push.delay(str(msg.id), str(result.peer_id))
    except Exception:
        log.exception("push_enqueue_failed", message_id=str(msg.id))


# ----------------------------------------------------------------------------------------
# Watermarks
# ----------------------------------------------------------------------------------------
def update_watermarks(
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    *,
    delivered_seq: int | None = None,
    read_seq: int | None = None,
) -> ConversationMember:
    """Advance watermarks monotonically. Returns the (possibly unchanged) membership.

    Values beyond ``last_seq`` are clamped; regressions are ignored. ``read`` implies
    ``delivered``. Raises 404 for non-members.
    """
    if read_seq is not None:
        with transaction.atomic():
            conv = (
                Conversation.objects.select_for_update()
                .filter(pk=conversation_id)
                .filter(Q(user_low_id=user_id) | Q(user_high_id=user_id))
                .first()
            )
            if conv is None:
                raise NotFound("Conversation not found.")
            member = ConversationMember.objects.get(conversation=conv, user_id=user_id)
            target = min(read_seq, conv.last_seq)
            if target > member.read_seq:
                unread = (
                    Message.objects.filter(conversation=conv, seq__gt=target)
                    .exclude(sender_id=user_id)
                    .count()
                )
                member.read_seq = target
                member.delivered_seq = max(member.delivered_seq, target)
                member.unread_count = unread
                member.save(update_fields=["read_seq", "delivered_seq", "unread_count"])
            if delivered_seq is not None:
                _advance_delivered(member, min(delivered_seq, conv.last_seq))
            return member

    conv = (
        Conversation.objects.filter(pk=conversation_id)
        .filter(Q(user_low_id=user_id) | Q(user_high_id=user_id))
        .only("id", "last_seq")
        .first()
    )
    if conv is None:
        raise NotFound("Conversation not found.")
    member = ConversationMember.objects.get(conversation=conv, user_id=user_id)
    if delivered_seq is not None:
        _advance_delivered(member, min(delivered_seq, conv.last_seq))
    return member


def _advance_delivered(member: ConversationMember, target: int) -> None:
    updated = ConversationMember.objects.filter(pk=member.pk, delivered_seq__lt=target).update(
        delivered_seq=target
    )
    if updated:
        member.delivered_seq = target
    else:
        member.refresh_from_db(fields=["delivered_seq", "read_seq", "unread_count"])


def publish_receipt(member: ConversationMember, *, changed: bool) -> None:
    if not changed:
        return
    payload = presenters.receipt(member)
    emit_sync(
        [
            Event(user_group(member.peer_id), "message.receipt", payload),
            Event(user_group(member.user_id), "message.receipt", payload),
        ]
    )


def mark(
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    *,
    delivered_seq: int | None = None,
    read_seq: int | None = None,
) -> ConversationMember:
    """Advance watermarks and publish ``message.receipt`` if anything moved."""
    before = (
        ConversationMember.objects.filter(conversation_id=conversation_id, user_id=user_id)
        .values_list("delivered_seq", "read_seq")
        .first()
    )
    member = update_watermarks(
        user_id, conversation_id, delivered_seq=delivered_seq, read_seq=read_seq
    )
    changed = before is None or before != (member.delivered_seq, member.read_seq)
    publish_receipt(member, changed=changed)
    return member
