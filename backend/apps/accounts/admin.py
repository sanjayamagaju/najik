"""Admin for accounts. Secrets (password/refresh hashes, push tokens) are never displayed."""

from __future__ import annotations

from typing import Any

from django.contrib import admin, messages
from django.db.models import QuerySet
from django.http import HttpRequest

from apps.accounts import services
from apps.accounts.models import PushToken, Session, User


class SessionInline(admin.TabularInline):
    model = Session
    extra = 0
    can_delete = False
    fields = (
        "platform",
        "device_name",
        "app_version",
        "created_at",
        "last_active_at",
        "revoked_at",
        "revoke_reason",
    )
    readonly_fields = fields
    show_change_link = True

    def has_add_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = (
        "username",
        "display_name",
        "is_active",
        "is_staff",
        "created_at",
        "last_seen_at",
    )
    list_filter = ("is_active", "is_staff")
    search_fields = ("username", "display_name", "email")
    ordering = ("-created_at",)
    readonly_fields = ("id", "avatar_color", "created_at", "last_seen_at", "last_login")
    fields = (
        "id",
        "username",
        "display_name",
        "email",
        "avatar_color",
        "show_message_preview",
        "is_active",
        "is_staff",
        "is_superuser",
        "created_at",
        "last_seen_at",
        "last_login",
    )
    inlines = (SessionInline,)
    actions = ("revoke_all_sessions",)

    @admin.action(description="Revoke all sessions (log out everywhere)")
    def revoke_all_sessions(self, request: HttpRequest, queryset: QuerySet[User]) -> None:
        sessions = Session.objects.filter(user__in=queryset, revoked_at__isnull=True)
        count = len(services.revoke_sessions(list(sessions), reason="admin"))
        self.message_user(request, f"Revoked {count} session(s).", messages.SUCCESS)


@admin.register(Session)
class SessionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "platform",
        "device_name",
        "app_version",
        "last_active_at",
        "revoked_at",
    )
    list_filter = ("platform", "revoke_reason")
    search_fields = ("user__username", "id")
    list_select_related = ("user",)
    readonly_fields = (
        "id",
        "user",
        "device_id",
        "platform",
        "device_name",
        "app_version",
        "created_at",
        "last_active_at",
        "expires_at",
        "revoked_at",
        "revoke_reason",
    )
    fields = readonly_fields
    actions = ("revoke",)

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    @admin.action(description="Revoke selected sessions")
    def revoke(self, request: HttpRequest, queryset: QuerySet[Session]) -> None:
        count = len(
            services.revoke_sessions(list(queryset.filter(revoked_at__isnull=True)), reason="admin")
        )
        self.message_user(request, f"Revoked {count} session(s).", messages.SUCCESS)


@admin.register(PushToken)
class PushTokenAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "provider", "session", "updated_at")
    list_filter = ("provider",)
    search_fields = ("user__username",)
    list_select_related = ("user", "session")
    # The token itself is a credential for reaching the device: never shown.
    fields = ("id", "user", "session", "provider", "created_at", "updated_at")
    readonly_fields = fields

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False
