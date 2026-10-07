"""Ephemeral TURN credentials (TURN REST API / coturn ``use-auth-secret``).

``username = "<unix expiry>:<user_id>"`` and
``credential = base64(HMAC-SHA1(TURN_SECRET, username))``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time
import uuid
from typing import Any

from django.conf import settings


def turn_credentials(user_id: uuid.UUID | str, *, now: float | None = None) -> tuple[str, str]:
    expiry = int(now if now is not None else time.time()) + settings.TURN_CREDENTIAL_TTL_SEC
    username = f"{expiry}:{user_id}"
    digest = hmac.new(settings.TURN_SECRET.encode(), username.encode(), hashlib.sha1).digest()
    return username, base64.b64encode(digest).decode()


def ice_servers(user_id: uuid.UUID | str) -> dict[str, Any]:
    servers: list[dict[str, Any]] = []
    if settings.STUN_URLS:
        servers.append({"urls": list(settings.STUN_URLS)})
    if settings.TURN_URLS and settings.TURN_SECRET:
        username, credential = turn_credentials(user_id)
        servers.append(
            {"urls": list(settings.TURN_URLS), "username": username, "credential": credential}
        )
    return {"ice_servers": servers, "ttl_sec": settings.TURN_CREDENTIAL_TTL_SEC}
