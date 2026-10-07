"""Conversation, message, read-receipt, ping and presence endpoints."""

from __future__ import annotations

import uuid
from typing import Any

from django.db.models import Q
from rest_framework import serializers, status
from rest_framework.exceptions import ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.serializers import StrictSerializer
from apps.accounts.views import _limit, _validated
from apps.chat import presenters, services
from apps.chat.models import ConversationMember, Message, MessageKind
from apps.core.pagination import decode_cursor, encode_cursor, parse_int, parse_limit
from apps.core.utils import clean_text
from apps.realtime.presence import presence_for


class CreateConversationSerializer(StrictSerializer):
    user_id = serializers.UUIDField()


class CleanTextField(serializers.CharField):
    """Strips control characters (incl. NUL) before validation instead of rejecting them."""

    def to_internal_value(self, data: Any) -> str:
        return clean_text(super().to_internal_value(data))


class SendMessageSerializer(StrictSerializer):
    client_id = serializers.UUIDField()
    body = CleanTextField(max_length=20000, trim_whitespace=False, allow_blank=True)

    def validate_body(self, value: str) -> str:
        return validate_body(value)


class PingSerializer(StrictSerializer):
    client_id = serializers.UUIDField()


class ReadSerializer(StrictSerializer):
    seq = serializers.IntegerField(min_value=0, max_value=2**62)


def validate_body(value: str) -> str:
    cleaned = clean_text(value)
    if not 1 <= len(cleaned) <= services.MAX_BODY_CHARS:
        raise serializers.ValidationError(
            f"Message must be 1-{services.MAX_BODY_CHARS} characters."
        )
    return cleaned


def message_rate_limit(user_id: uuid.UUID) -> None:
    _limit(("message_burst", str(user_id)), ("message_hour", str(user_id)))


def ping_rate_limit(user_id: uuid.UUID, conversation_id: uuid.UUID) -> None:
    _limit(("ping_pair", f"{user_id}|{conversation_id}"), ("ping_hour", str(user_id)))


class ConversationListView(APIView):
    def get(self, request: Request) -> Response:
        limit = parse_limit(request.query_params.get("limit"), default=30, maximum=100)
        qs = (
            ConversationMember.objects.select_related(
                "conversation", "conversation__last_message", "peer"
            )
            .filter(user=request.user, has_messages=True)
            .order_by("-sort_at", "-conversation_id")
        )
        cursor = request.query_params.get("cursor")
        if cursor:
            ts, pk = decode_cursor(cursor)
            qs = qs.filter(Q(sort_at__lt=ts) | Q(sort_at=ts, conversation_id__lt=pk))
        members = list(qs[: limit + 1])
        next_cursor = None
        if len(members) > limit:
            members = members[:limit]
            last = members[-1]
            next_cursor = encode_cursor(last.sort_at, last.conversation_id)
        return Response(
            {"results": services.conversation_payloads(members), "next_cursor": next_cursor}
        )

    def post(self, request: Request) -> Response:
        s = _validated(CreateConversationSerializer, request)
        conv, created = services.get_or_create_conversation(
            request.user, s.validated_data["user_id"]
        )
        return Response(
            services.conversation_payload(request.user.id, conv.id),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class ConversationDetailView(APIView):
    def get(self, request: Request, conversation_id: uuid.UUID) -> Response:
        return Response(services.conversation_payload(request.user.id, conversation_id))


class MessageListView(APIView):
    def get(self, request: Request, conversation_id: uuid.UUID) -> Response:
        services.get_membership(request.user.id, conversation_id)
        params = request.query_params
        before = parse_int(params.get("before_seq"), "before_seq", minimum=1)
        after = parse_int(params.get("after_seq"), "after_seq", minimum=0)
        if before is not None and after is not None:
            raise ValidationError({"non_field_errors": ["Use either before_seq or after_seq."]})
        limit = parse_limit(params.get("limit"), default=50, maximum=100)
        qs = Message.objects.filter(conversation_id=conversation_id)
        if after is not None:
            rows = list(qs.filter(seq__gt=after).order_by("seq")[: limit + 1])
            has_more = len(rows) > limit
            rows = rows[:limit]
        else:
            if before is not None:
                qs = qs.filter(seq__lt=before)
            rows = list(qs.order_by("-seq")[: limit + 1])
            has_more = len(rows) > limit
            rows = list(reversed(rows[:limit]))
        return Response({"results": [presenters.message(m) for m in rows], "has_more": has_more})

    def post(self, request: Request, conversation_id: uuid.UUID) -> Response:
        s = _validated(SendMessageSerializer, request)
        message_rate_limit(request.user.id)
        result = services.send_message(
            request.user,
            conversation_id,
            s.validated_data["client_id"],
            kind=MessageKind.TEXT,
            body=s.validated_data["body"],
        )
        services.publish_new_message(result, request.user)
        return Response(
            presenters.message(result.message),
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )


class ReadView(APIView):
    def post(self, request: Request, conversation_id: uuid.UUID) -> Response:
        s = _validated(ReadSerializer, request)
        member = services.mark(request.user.id, conversation_id, read_seq=s.validated_data["seq"])
        return Response(
            {
                "conversation_id": str(conversation_id),
                "delivered_seq": member.delivered_seq,
                "read_seq": member.read_seq,
                "unread_count": member.unread_count,
            }
        )


class PingView(APIView):
    def post(self, request: Request, conversation_id: uuid.UUID) -> Response:
        s = _validated(PingSerializer, request)
        services.get_membership(request.user.id, conversation_id)
        ping_rate_limit(request.user.id, conversation_id)
        result = services.send_message(
            request.user, conversation_id, s.validated_data["client_id"], kind=MessageKind.PING
        )
        services.publish_new_message(result, request.user)
        return Response(
            presenters.message(result.message),
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )


class PresenceView(APIView):
    MAX_IDS = 200

    def get(self, request: Request) -> Response:
        raw = request.query_params.get("user_ids", "")
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        if len(parts) > self.MAX_IDS:
            raise ValidationError({"user_ids": [f"At most {self.MAX_IDS} ids."]})
        ids: list[Any] = []
        for p in parts:
            try:
                ids.append(uuid.UUID(p))
            except ValueError as exc:
                raise ValidationError({"user_ids": ["Invalid user id."]}) from exc
        allowed = services.shared_peer_ids(request.user.id, ids)
        return Response({"results": presence_for([i for i in ids if i in allowed])})
