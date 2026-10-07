"""JSON representations of account objects (shared by REST and WebSocket)."""

from __future__ import annotations

from typing import Any

from apps.accounts.models import Session, User
from apps.core.utils import iso


def public_user(user: User) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "username": user.username,
        "display_name": user.display_name,
        "avatar_color": user.avatar_color,
        "created_at": iso(user.created_at),
    }


def me(user: User) -> dict[str, Any]:
    return {
        **public_user(user),
        "email": user.email,
        "show_message_preview": user.show_message_preview,
    }


def session(s: Session, *, current_session_id: Any) -> dict[str, Any]:
    return {
        "id": str(s.id),
        "device_name": s.device_name,
        "platform": s.platform,
        "app_version": s.app_version,
        "created_at": iso(s.created_at),
        "last_active_at": iso(s.last_active_at),
        "ip_country": None,
        "current": str(s.id) == str(current_session_id),
    }
