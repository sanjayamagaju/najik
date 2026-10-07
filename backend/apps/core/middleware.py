"""Request-ID propagation and structured access logging (sync- and async-capable)."""

from __future__ import annotations

import re
import time
import uuid
from collections.abc import Callable
from typing import Any

import structlog
from asgiref.sync import iscoroutinefunction, markcoroutinefunction
from django.http import HttpRequest, HttpResponse

from apps.core import metrics
from apps.core.logging import get_logger

_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
access_log = get_logger("najik.access")


def _request_id(request: HttpRequest) -> str:
    incoming = request.headers.get("X-Request-ID", "")
    return incoming if _VALID_REQUEST_ID.match(incoming) else uuid.uuid4().hex


class _DualMiddleware:
    sync_capable = True
    async_capable = True

    def __init__(self, get_response: Callable[[HttpRequest], Any]) -> None:
        self.get_response = get_response
        self.is_async = iscoroutinefunction(get_response)
        if self.is_async:
            markcoroutinefunction(self)

    def __call__(self, request: HttpRequest) -> Any:
        if self.is_async:
            return self.__acall__(request)
        self.before(request)
        response = self.get_response(request)
        return self.after(request, response)

    async def __acall__(self, request: HttpRequest) -> HttpResponse:
        self.before(request)
        response = await self.get_response(request)
        return self.after(request, response)

    def before(self, request: HttpRequest) -> None:
        return None

    def after(self, request: HttpRequest, response: HttpResponse) -> HttpResponse:
        return response


class RequestIdMiddleware(_DualMiddleware):
    """Accepts a well-formed ``X-Request-ID`` or generates one; echoes it on the response."""

    def before(self, request: HttpRequest) -> None:
        request_id = _request_id(request)
        request.request_id = request_id  # type: ignore[attr-defined]
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

    def after(self, request: HttpRequest, response: HttpResponse) -> HttpResponse:
        response["X-Request-ID"] = getattr(request, "request_id", "")
        return response


class AccessLogMiddleware(_DualMiddleware):
    """One structured line per request. Never logs query strings or bodies."""

    QUIET_ROUTES = frozenset({"healthz", "readyz", "metrics"})

    def before(self, request: HttpRequest) -> None:
        request._started_at = time.perf_counter()  # type: ignore[attr-defined]

    def after(self, request: HttpRequest, response: HttpResponse) -> HttpResponse:
        started = getattr(request, "_started_at", None) or time.perf_counter()
        duration = time.perf_counter() - started
        match = getattr(request, "resolver_match", None)
        route = str(match.route) if match else "unmatched"
        user = getattr(request, "user", None)
        user_id = str(user.pk) if user is not None and getattr(user, "pk", None) else None
        if route not in self.QUIET_ROUTES:
            access_log.info(
                "http_request",
                method=request.method,
                route=route,
                status=response.status_code,
                duration_ms=round(duration * 1000, 1),
                user_id=user_id,
            )
        metrics.observe_http(request.method or "", route, response.status_code, duration)
        return response
