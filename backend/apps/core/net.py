"""Client IP resolution behind a known number of trusted reverse proxies."""

from __future__ import annotations

from django.conf import settings
from django.http import HttpRequest


def client_ip(request: HttpRequest) -> str:
    """Return the client IP used for per-IP rate limits.

    The uvicorn worker rewrites ``REMOTE_ADDR`` from ``X-Forwarded-For`` when the peer is listed
    in ``FORWARDED_ALLOW_IPS``. When ``TRUSTED_PROXY_COUNT`` > 0 the n-th address from the right
    of ``X-Forwarded-For`` is used instead (the address our own proxy appended).
    """
    count = settings.TRUSTED_PROXY_COUNT
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if count > 0 and forwarded:
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if len(parts) >= count:
            return parts[-count]
    return request.META.get("REMOTE_ADDR", "") or "unknown"
