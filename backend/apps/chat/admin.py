"""Chat admin. Message bodies are never displayed (privacy)."""

from __future__ import annotations

from typing import Any

from django.contrib import admin
from django.http import HttpRequest

from apps.chat.models import Conversation, ConversationMember, Message


class MemberInline(admin.TabularInline):
    model = ConversationMember
    extra = 0
    can_delete = False
    fields = ("user", "delivered_seq", "read_seq", "unread_count", "sort_at")
    readonly_fields = fields

    def has_add_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ("id", "user_low", "user_high", "last_seq", "updated_at")
    list_select_related = ("user_low", "user_high")
    search_fields = ("id", "user_low__username", "user_high__username")
    fields = ("id", "user_low", "user_high", "last_seq", "created_at", "updated_at")
    readonly_fields = fields
    inlines = (MemberInline,)

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("id", "conversation", "sender", "seq", "kind", "created_at")
    list_filter = ("kind",)
    list_select_related = ("sender",)
    search_fields = ("id", "conversation__id")
    # `body` is intentionally excluded from every admin view.
    fields = ("id", "conversation", "sender", "client_id", "seq", "kind", "meta", "created_at")
    readonly_fields = fields

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False
