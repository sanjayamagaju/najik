"""DRF authentication with access JWTs bound to revocable sessions."""

from __future__ import annotations

from typing import Any

import structlog
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.request import Request

from apps.accounts.models import User
from apps.accounts.revocation import is_revoked
from apps.accounts.tokens import AccessClaims, TokenError, decode_access_token
from apps.core.errors import AuthError


class JWTAuthentication(BaseAuthentication):
    keyword = b"bearer"

    def authenticate(self, request: Request) -> tuple[User, AccessClaims] | None:
        header = get_authorization_header(request).split()
        if not header:
            return None
        if header[0].lower() != self.keyword or len(header) != 2:
            raise AuthError("token_invalid", "Malformed Authorization header.")
        try:
            claims = decode_access_token(header[1].decode("ascii"))
        except UnicodeDecodeError as exc:
            raise AuthError("token_invalid", "Invalid token.") from exc
        except TokenError as exc:
            raise AuthError(exc.code, exc.message) from exc
        if is_revoked(claims.session_id):
            raise AuthError("session_revoked", "This session has been revoked.")
        user = User.objects.filter(pk=claims.user_id, is_active=True).first()
        if user is None:
            raise AuthError("session_revoked", "This session has been revoked.")
        structlog.contextvars.bind_contextvars(user_id=str(user.id))
        return user, claims

    def authenticate_header(self, request: Request) -> str:
        return 'Bearer realm="api"'


def session_id_of(request: Any) -> Any:
    """The current session id (``request.auth`` holds the :class:`AccessClaims`)."""
    return request.auth.session_id
