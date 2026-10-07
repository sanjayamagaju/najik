"""Access JWTs (HS256) and opaque rotating refresh tokens.

Access claims are exactly ``sub``, ``sid``, ``jti``, ``exp``, ``iat`` and ``type="access"``.
Refresh tokens are 256-bit random strings; the server stores only their SHA-256 hash.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime

import jwt
from django.conf import settings

from apps.core.utils import utcnow


class TokenError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True, slots=True)
class AccessClaims:
    user_id: uuid.UUID
    session_id: uuid.UUID
    jti: str
    expires_at: datetime


def _key() -> str:
    return settings.JWT_SIGNING_KEY or settings.SECRET_KEY


def issue_access_token(user_id: uuid.UUID, session_id: uuid.UUID) -> tuple[str, datetime]:
    now = utcnow().replace(microsecond=0)
    expires_at = now + settings.ACCESS_TOKEN_LIFETIME
    claims = {
        "sub": str(user_id),
        "sid": str(session_id),
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "type": "access",
    }
    token = jwt.encode(claims, _key(), algorithm=settings.JWT_ALGORITHM)
    return token, expires_at


def decode_access_token(token: str) -> AccessClaims:
    """Validate signature, expiry and claim shape. Raises :class:`TokenError`."""
    if not token or len(token) > 2048:
        raise TokenError("token_invalid", "Invalid token.")
    try:
        claims = jwt.decode(
            token,
            _key(),
            algorithms=[settings.JWT_ALGORITHM],
            leeway=settings.JWT_LEEWAY_SEC,
            options={"require": ["sub", "sid", "jti", "exp", "iat", "type"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("token_expired", "Access token expired.") from exc
    except jwt.PyJWTError as exc:
        raise TokenError("token_invalid", "Invalid token.") from exc
    if claims.get("type") != "access":
        raise TokenError("token_invalid", "Invalid token type.")
    try:
        user_id = uuid.UUID(str(claims["sub"]))
        session_id = uuid.UUID(str(claims["sid"]))
        expires_at = datetime.fromtimestamp(int(claims["exp"]), tz=utcnow().tzinfo)
    except (ValueError, TypeError) as exc:
        raise TokenError("token_invalid", "Invalid token claims.") from exc
    return AccessClaims(user_id, session_id, str(claims["jti"]), expires_at)


def new_refresh_token() -> tuple[str, str]:
    """Return ``(raw_token, sha256_hex)``."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
