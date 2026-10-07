"""Liveness and readiness probes (public, outside ``/api/v1``)."""

from __future__ import annotations

from django.db import connection
from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_GET

from apps.core.logging import get_logger
from apps.core.redis import get_redis

log = get_logger(__name__)


@require_GET
def healthz(request: HttpRequest) -> JsonResponse:
    """Liveness: the process is up. No dependency checks."""
    return JsonResponse({"status": "ok"})


@require_GET
def readyz(request: HttpRequest) -> JsonResponse:
    """Readiness: database and Redis reachable."""
    checks: dict[str, str] = {}
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        checks["db"] = "ok"
    except Exception as exc:
        log.warning("readyz_db_failed", error=type(exc).__name__)
        checks["db"] = "error"
    try:
        get_redis().ping()
        checks["redis"] = "ok"
    except Exception as exc:
        log.warning("readyz_redis_failed", error=type(exc).__name__)
        checks["redis"] = "error"
    if all(v == "ok" for v in checks.values()):
        return JsonResponse({"status": "ok", "checks": checks})
    return JsonResponse({"status": "degraded", "checks": checks}, status=503)
