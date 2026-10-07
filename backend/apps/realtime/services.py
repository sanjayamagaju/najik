"""Sync helpers used by the consumer (via ``database_sync_to_async``) and Celery."""

from __future__ import annotations

import uuid
from typing import Any

from django.utils import timezone

from apps.accounts.models import Session, User
from apps.core.logging import get_logger
from apps.realtime import presence
from apps.realtime.events import Event, emit_sync, presence_group

log = get_logger(__name__)

SESSION_TOUCH_INTERVAL_SEC = 300


def load_session(user_id: uuid.UUID, session_id: uuid.UUID) -> tuple[User, Session] | None:
    """Return the active user and session for a WebSocket, touching ``last_active_at``."""
    now = timezone.now()
    session = (
        Session.objects.select_related("user")
        .filter(
            pk=session_id,
            user_id=user_id,
            revoked_at__isnull=True,
            expires_at__gt=now,
            user__is_active=True,
        )
        .first()
    )
    if session is None:
        return None
    if (now - session.last_active_at).total_seconds() > SESSION_TOUCH_INTERVAL_SEC:
        Session.objects.filter(pk=session.pk).update(last_active_at=now)
    return session.user, session


def publish_presence(user_id: Any, transition: int) -> None:
    """Persist last-seen on going offline and notify presence subscribers."""
    if transition == 0:
        return
    online = transition > 0
    if online:
        last_seen = User.objects.filter(pk=user_id).values_list("last_seen_at", flat=True).first()
    else:
        last_seen = timezone.now()
        User.objects.filter(pk=user_id).update(last_seen_at=last_seen)
    emit_sync(
        [
            Event(
                presence_group(user_id),
                "presence",
                presence.presence_payload(user_id, online, last_seen),
            )
        ]
    )
    log.info("presence_changed", user_id=str(user_id), online=online)


def sweep_presence() -> int:
    """Mark users offline whose connections expired without a clean disconnect."""
    changed = 0
    for user_id in presence.online_user_ids():
        update = presence.check(user_id)
        if update.transition == -1:
            publish_presence(user_id, -1)
            changed += 1
    return changed
