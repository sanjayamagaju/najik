"""Error types and the DRF exception handler producing the contract error shape.

Every non-2xx REST response looks like::

    {"error": {"code": "...", "message": "...", "details": {...}}}
"""

from __future__ import annotations

import math
from typing import Any

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404, HttpRequest, JsonResponse
from rest_framework import exceptions, status
from rest_framework.response import Response

from apps.core.logging import get_logger

log = get_logger(__name__)


class ApiError(exceptions.APIException):
    """Base class for errors that carry an explicit contract ``code``."""

    status_code = status.HTTP_400_BAD_REQUEST
    code = "bad_request"
    default_detail = "Bad request."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        details: dict[str, Any] | None = None,
        status_code: int | None = None,
    ) -> None:
        self.message = message or str(self.default_detail)
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        self.details = details or {}
        super().__init__(self.message, self.code)


class Conflict(ApiError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"
    default_detail = "Conflict."


class NotFound(ApiError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"
    default_detail = "Not found."


class Forbidden(ApiError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"
    default_detail = "You do not have permission to perform this action."


class InvalidCredentials(ApiError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "invalid_credentials"
    default_detail = "Invalid username or password."


class AuthError(exceptions.AuthenticationFailed):
    """401 with one of ``token_expired`` / ``token_invalid`` / ``session_revoked``."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message, code)
        self.contract_code = code


class RateLimited(exceptions.Throttled):
    def __init__(self, retry_after_sec: int) -> None:
        super().__init__(wait=retry_after_sec)


def validation_error(field: str, message: str) -> exceptions.ValidationError:
    return exceptions.ValidationError({field: [message]})


def _flatten_details(detail: Any) -> dict[str, Any]:
    """Normalise DRF validation detail into ``{"field": ["msg", ...]}``."""
    if isinstance(detail, dict):
        out: dict[str, Any] = {}
        for key, value in detail.items():
            if isinstance(value, dict):
                out[str(key)] = _flatten_details(value)
            elif isinstance(value, list):
                out[str(key)] = [str(v) if not isinstance(v, dict) else v for v in value]
            else:
                out[str(key)] = [str(value)]
        return out
    if isinstance(detail, list):
        return {"non_field_errors": [str(v) for v in detail]}
    return {"non_field_errors": [str(detail)]}


def error_body(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or {}}}


def exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    headers: dict[str, str] = {}

    if isinstance(exc, Http404):
        exc = NotFound()
    elif isinstance(exc, DjangoPermissionDenied):
        exc = Forbidden()

    if isinstance(exc, ApiError):
        return Response(error_body(exc.code, exc.message, exc.details), status=exc.status_code)
    if isinstance(exc, exceptions.ValidationError):
        return Response(
            error_body("validation_error", "Invalid input.", _flatten_details(exc.detail)),
            status=status.HTTP_400_BAD_REQUEST,
        )
    if isinstance(exc, exceptions.ParseError):
        return Response(
            error_body("validation_error", "Malformed request body.", {}),
            status=status.HTTP_400_BAD_REQUEST,
        )
    if isinstance(exc, AuthError):
        return Response(
            error_body(exc.contract_code, str(exc.detail)),
            status=status.HTTP_401_UNAUTHORIZED,
            headers={"WWW-Authenticate": 'Bearer realm="api"'},
        )
    if isinstance(exc, exceptions.NotAuthenticated | exceptions.AuthenticationFailed):
        return Response(
            error_body("not_authenticated", "Authentication credentials were not provided."),
            status=status.HTTP_401_UNAUTHORIZED,
            headers={"WWW-Authenticate": 'Bearer realm="api"'},
        )
    if isinstance(exc, exceptions.Throttled):
        wait = max(1, math.ceil(exc.wait or 1))
        headers["Retry-After"] = str(wait)
        return Response(
            error_body("rate_limited", "Too many requests.", {"retry_after_sec": wait}),
            status=status.HTTP_429_TOO_MANY_REQUESTS,
            headers=headers,
        )
    if isinstance(exc, exceptions.PermissionDenied):
        return Response(
            error_body("forbidden", "You do not have permission to perform this action."),
            status=status.HTTP_403_FORBIDDEN,
        )
    if isinstance(exc, exceptions.NotFound):
        return Response(error_body("not_found", "Not found."), status=status.HTTP_404_NOT_FOUND)
    if isinstance(exc, exceptions.MethodNotAllowed):
        return Response(
            error_body("method_not_allowed", "Method not allowed."),
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )
    if isinstance(exc, exceptions.UnsupportedMediaType):
        return Response(
            error_body("unsupported_media_type", "Use application/json."),
            status=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        )
    if isinstance(exc, exceptions.NotAcceptable):
        return Response(
            error_body("not_acceptable", "Not acceptable."),
            status=status.HTTP_406_NOT_ACCEPTABLE,
        )
    if isinstance(exc, exceptions.APIException):
        return Response(error_body(str(exc.default_code), str(exc.detail)), status=exc.status_code)

    view = context.get("view")
    log.exception("unhandled_api_error", view=type(view).__name__ if view else None)
    return Response(
        error_body("server_error", "Something went wrong."),
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )


# Django-level handlers so non-DRF paths also use the contract error shape.
def handler400(request: HttpRequest, exception: Exception | None = None) -> JsonResponse:
    return JsonResponse(error_body("validation_error", "Bad request."), status=400)


def handler403(request: HttpRequest, exception: Exception | None = None) -> JsonResponse:
    return JsonResponse(error_body("forbidden", "Forbidden."), status=403)


def handler404(request: HttpRequest, exception: Exception | None = None) -> JsonResponse:
    return JsonResponse(error_body("not_found", "Not found."), status=404)


def handler500(request: HttpRequest) -> JsonResponse:
    return JsonResponse(error_body("server_error", "Something went wrong."), status=500)
