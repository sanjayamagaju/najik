"""Fast session-revocation checks for access tokens.

Access tokens are stateless, so a revoked session's tokens stay cryptographically valid until
they expire (<= 15 min). Revocation writes a Redis marker that lives slightly longer than an
access token, so the per-request check is one Redis ``EXISTS`` instead of a DB query. If Redis
is unavailable the check falls back to the database (fail closed on revoked sessions).
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable

from django.conf import settings

from apps.core.logging import get_logger
from apps.core.redis import get_async_redis, get_redis, rkey

log = get_logger(__name__)


def _ttl() -> int:
    return int(settings.ACCESS_TOKEN_LIFETIME.total_seconds()) + settings.JWT_LEEWAY_SEC + 60


def mark_revoked(session_ids: Iterable[uuid.UUID | str]) -> None:
    ids = [str(s) for s in session_ids]
    if not ids:
        return
    try:
        pipe = get_redis().pipeline(transaction=False)
        for sid in ids:
            pipe.set(rkey("revoked", sid), "1", ex=_ttl())
        pipe.execute()
    except Exception:
        log.exception("revocation_marker_failed", count=len(ids))


def _db_is_revoked(session_id: uuid.UUID) -> bool:
    from apps.accounts.models import Session

    return not Session.objects.filter(pk=session_id, revoked_at__isnull=True).exists()


def is_revoked(session_id: uuid.UUID) -> bool:
    try:
        return bool(get_redis().exists(rkey("revoked", session_id)))
    except Exception:
        log.warning("revocation_check_redis_unavailable")
        return _db_is_revoked(session_id)


async def ais_revoked(session_id: uuid.UUID) -> bool:
    return bool(await get_async_redis().exists(rkey("revoked", session_id)))
