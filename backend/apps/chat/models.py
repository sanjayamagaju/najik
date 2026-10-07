"""1-to-1 conversations, per-member watermarks and gap-free sequenced messages."""

from __future__ import annotations

from typing import ClassVar

from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.utils import timezone

from apps.core.utils import uuid7


class Conversation(models.Model):
    """A conversation between exactly two users, stored as an ordered pair (low < high)."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    user_low = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    user_high = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    # Highest assigned seq; incremented under SELECT ... FOR UPDATE on this row.
    last_seq = models.BigIntegerField(default=0)
    last_message = models.ForeignKey(
        "chat.Message", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints: ClassVar = [
            models.UniqueConstraint(fields=["user_low", "user_high"], name="conversation_pair"),
            models.CheckConstraint(
                condition=Q(user_low__lt=F("user_high")), name="conversation_pair_ordered"
            ),
        ]
        indexes: ClassVar = [
            models.Index(fields=["user_high"], name="conversation_user_high_idx"),
        ]

    def __str__(self) -> str:
        return f"conversation {self.id}"


class ConversationMember(models.Model):
    """A user's view of a conversation: watermarks and a denormalised unread counter.

    ``unread_count`` is only modified while the conversation row is locked, so it always
    equals ``count(messages from peer with seq > read_seq)``.
    """

    id = models.BigAutoField(primary_key=True)
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    peer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    delivered_seq = models.BigIntegerField(default=0)
    read_seq = models.BigIntegerField(default=0)
    unread_count = models.IntegerField(default=0)
    # Copy of conversation.updated_at for the per-user inbox ordering index.
    sort_at = models.DateTimeField(default=timezone.now)
    has_messages = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        constraints: ClassVar = [
            models.UniqueConstraint(fields=["conversation", "user"], name="member_unique"),
            models.UniqueConstraint(fields=["user", "peer"], name="member_user_peer_unique"),
            models.CheckConstraint(condition=Q(read_seq__gte=0), name="member_read_seq_gte0"),
            models.CheckConstraint(
                condition=Q(delivered_seq__gte=F("read_seq")), name="member_delivered_gte_read"
            ),
        ]
        indexes: ClassVar = [
            # Inbox: WHERE user=? AND has_messages ORDER BY sort_at DESC, conversation_id DESC
            models.Index(
                fields=["user", "has_messages", "-sort_at", "-conversation"],
                name="member_inbox_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} in {self.conversation_id}"


class MessageKind(models.TextChoices):
    TEXT = "text", "Text"
    PING = "ping", "Ping"
    CALL = "call", "Call"


class Message(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="messages"
    )
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    client_id = models.UUIDField()
    seq = models.BigIntegerField()
    kind = models.CharField(max_length=8, choices=MessageKind.choices, default=MessageKind.TEXT)
    body = models.TextField(blank=True, default="")
    meta = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        constraints: ClassVar = [
            # Also serves history paging: WHERE conversation=? AND seq </> ? ORDER BY seq.
            models.UniqueConstraint(fields=["conversation", "seq"], name="message_conv_seq"),
            models.UniqueConstraint(fields=["sender", "client_id"], name="message_sender_client"),
            models.CheckConstraint(condition=Q(seq__gte=1), name="message_seq_gte1"),
        ]

    def __str__(self) -> str:
        return f"message {self.conversation_id}#{self.seq}"
