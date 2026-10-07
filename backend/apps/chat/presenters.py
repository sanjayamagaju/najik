"""JSON representations of conversations and messages."""

from __future__ import annotations

from typing import Any

from apps.accounts.presenters import public_user
from apps.chat.models import ConversationMember, Message
from apps.core.utils import iso


def message(m: Message) -> dict[str, Any]:
    return {
        "id": str(m.id),
        "client_id": str(m.client_id),
        "conversation_id": str(m.conversation_id),
        "sender_id": str(m.sender_id),
        "seq": m.seq,
        "kind": m.kind,
        "body": m.body,
        "meta": m.meta or {},
        "created_at": iso(m.created_at),
    }


def conversation(
    mine: ConversationMember, peer_member: ConversationMember | None
) -> dict[str, Any]:
    conv = mine.conversation
    return {
        "id": str(conv.id),
        "peer": public_user(mine.peer),
        "last_message": message(conv.last_message) if conv.last_message_id else None,
        "last_seq": conv.last_seq,
        "unread_count": mine.unread_count,
        "my_read_seq": mine.read_seq,
        "peer_delivered_seq": peer_member.delivered_seq if peer_member else 0,
        "peer_read_seq": peer_member.read_seq if peer_member else 0,
        "updated_at": iso(conv.updated_at),
    }


def receipt(member: ConversationMember) -> dict[str, Any]:
    return {
        "conversation_id": str(member.conversation_id),
        "user_id": str(member.user_id),
        "delivered_seq": member.delivered_seq,
        "read_seq": member.read_seq,
    }
