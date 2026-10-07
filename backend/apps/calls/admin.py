from __future__ import annotations

from typing import Any

from django.contrib import admin
from django.http import HttpRequest

from apps.calls.models import Call, CallMetrics


class MetricsInline(admin.TabularInline):
    model = CallMetrics
    extra = 0
    can_delete = False
    fields = (
        "user",
        "rtt_ms_avg",
        "jitter_ms_avg",
        "packet_loss_pct_avg",
        "reconnects",
        "duration_sec",
        "network_type",
    )
    readonly_fields = fields

    def has_add_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False


@admin.register(Call)
class CallAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "caller",
        "callee",
        "media",
        "state",
        "end_reason",
        "created_at",
        "answered_at",
        "ended_at",
    )
    list_filter = ("state", "media", "end_reason")
    search_fields = ("id", "caller__username", "callee__username")
    list_select_related = ("caller", "callee")
    fields = (
        "id",
        "conversation",
        "caller",
        "callee",
        "media",
        "state",
        "end_reason",
        "caller_session",
        "callee_session",
        "created_at",
        "answered_at",
        "ended_at",
    )
    readonly_fields = fields
    inlines = (MetricsInline,)

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False


@admin.register(CallMetrics)
class CallMetricsAdmin(admin.ModelAdmin):
    list_display = (
        "call",
        "user",
        "rtt_ms_avg",
        "packet_loss_pct_avg",
        "duration_sec",
        "network_type",
        "created_at",
    )
    list_select_related = ("user",)

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False
