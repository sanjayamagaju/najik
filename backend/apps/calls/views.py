"""Call history, ICE servers and client quality metrics."""

from __future__ import annotations

import uuid
from typing import Any

from django.db.models import Q
from rest_framework import serializers, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.presenters import public_user
from apps.accounts.serializers import StrictSerializer
from apps.accounts.views import _validated
from apps.calls import presenters, services
from apps.calls.ice import ice_servers
from apps.calls.models import Call, CallMetrics
from apps.core import metrics
from apps.core.pagination import decode_cursor, encode_cursor, parse_limit


class IceServersView(APIView):
    def get(self, request: Request) -> Response:
        return Response(ice_servers(request.user.id))


class CallListView(APIView):
    def get(self, request: Request) -> Response:
        limit = parse_limit(request.query_params.get("limit"), default=30, maximum=100)
        me = request.user.id
        qs = (
            Call.objects.filter(Q(caller_id=me) | Q(callee_id=me))
            .select_related("caller", "callee")
            .order_by("-created_at", "-id")
        )
        cursor = request.query_params.get("cursor")
        if cursor:
            ts, pk = decode_cursor(cursor)
            qs = qs.filter(Q(created_at__lt=ts) | Q(created_at=ts, id__lt=pk))
        calls = list(qs[: limit + 1])
        next_cursor = None
        if len(calls) > limit:
            calls = calls[:limit]
            next_cursor = encode_cursor(calls[-1].created_at, calls[-1].id)
        results = [
            {
                **presenters.call(c),
                "peer": public_user(c.callee if c.caller_id == me else c.caller),
            }
            for c in calls
        ]
        return Response({"results": results, "next_cursor": next_cursor})


class CallDetailView(APIView):
    def get(self, request: Request, call_id: uuid.UUID) -> Response:
        return Response(presenters.call(services.call_for_participant(request.user.id, call_id)))


class CallMetricsSerializer(StrictSerializer):
    rtt_ms_avg = serializers.FloatField(
        min_value=0, max_value=60000, required=False, allow_null=True
    )
    jitter_ms_avg = serializers.FloatField(
        min_value=0, max_value=60000, required=False, allow_null=True
    )
    packet_loss_pct_avg = serializers.FloatField(
        min_value=0, max_value=100, required=False, allow_null=True
    )
    bitrate_kbps_avg_up = serializers.FloatField(
        min_value=0, max_value=1_000_000, required=False, allow_null=True
    )
    bitrate_kbps_avg_down = serializers.FloatField(
        min_value=0, max_value=1_000_000, required=False, allow_null=True
    )
    video_quality_changes = serializers.IntegerField(
        min_value=0, max_value=100_000, required=False, allow_null=True
    )
    reconnects = serializers.IntegerField(
        min_value=0, max_value=100_000, required=False, allow_null=True
    )
    duration_sec = serializers.IntegerField(
        min_value=0, max_value=7 * 24 * 3600, required=False, allow_null=True
    )
    network_type = serializers.CharField(max_length=16, required=False, allow_blank=True)
    selected_video_quality = serializers.ChoiceField(
        choices=["auto", "144p", "240p", "360p", "480p", "720p", "1080p"],
        required=False,
        allow_blank=True,
    )
    selected_audio_quality = serializers.ChoiceField(
        choices=["auto", "low", "medium", "high"], required=False, allow_blank=True
    )


def _observe(data: dict[str, Any]) -> None:
    pairs = [
        (metrics.CALL_RTT, "rtt_ms_avg"),
        (metrics.CALL_JITTER, "jitter_ms_avg"),
        (metrics.CALL_LOSS, "packet_loss_pct_avg"),
        (metrics.CALL_BITRATE_DOWN, "bitrate_kbps_avg_down"),
        (metrics.CALL_DURATION, "duration_sec"),
        (metrics.CALL_RECONNECTS, "reconnects"),
    ]
    for histogram, key in pairs:
        if data.get(key) is not None:
            histogram.observe(data[key])


class CallMetricsView(APIView):
    def post(self, request: Request, call_id: uuid.UUID) -> Response:
        call = services.call_for_participant(request.user.id, call_id)
        s = _validated(CallMetricsSerializer, request)
        _, created = CallMetrics.objects.update_or_create(
            call=call, user=request.user, defaults=dict(s.validated_data)
        )
        if created:
            _observe(s.validated_data)
        return Response(status=status.HTTP_202_ACCEPTED)
