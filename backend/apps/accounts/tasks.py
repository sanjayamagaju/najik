"""Housekeeping for tokens and sessions."""

from __future__ import annotations

from datetime import timedelta

from celery import shared_task
from django.db.models import Q
from django.utils import timezone

from apps.accounts.models import RefreshToken, Session
from apps.core.logging import get_logger

log = get_logger(__name__)

# Keep rotated tokens for a while so reuse is still detected (and the session revoked).
ROTATED_RETENTION = timedelta(days=30)
REVOKED_SESSION_RETENTION = timedelta(days=90)


@shared_task(ignore_result=True)
def cleanup_expired_tokens() -> dict[str, int]:
    now = timezone.now()
    tokens, _ = RefreshToken.objects.filter(
        Q(expires_at__lt=now) | Q(rotated_at__lt=now - ROTATED_RETENTION)
    ).delete()
    sessions, _ = Session.objects.filter(
        Q(revoked_at__lt=now - REVOKED_SESSION_RETENTION)
        | Q(expires_at__lt=now - REVOKED_SESSION_RETENTION)
    ).delete()
    log.info("token_cleanup", refresh_tokens=tokens, sessions=sessions)
    return {"refresh_tokens": tokens, "sessions": sessions}
