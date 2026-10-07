"""Account, session and token lifecycle."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import PushToken, RefreshToken, Session, User
from apps.accounts.revocation import mark_revoked
from apps.accounts.tokens import hash_refresh_token, issue_access_token, new_refresh_token
from apps.core import ratelimit
from apps.core.errors import AuthError, Conflict, InvalidCredentials, RateLimited
from apps.core.logging import get_logger
from apps.core.utils import iso
from apps.realtime.events import Event, emit_sync, session_group

log = get_logger(__name__)

# Used to equalise timing when the username does not exist.
_DUMMY_PASSWORD_HASH = make_password("najik-timing-equaliser")


@dataclass(frozen=True, slots=True)
class DeviceInfo:
    device_id: uuid.UUID
    platform: str
    name: str
    app_version: str


def issue_tokens(session: Session) -> dict[str, Any]:
    """Create a fresh refresh token for ``session`` and an access token."""
    raw, digest = new_refresh_token()
    refresh_expires_at = timezone.now() + settings.REFRESH_TOKEN_LIFETIME
    RefreshToken.objects.create(session=session, token_hash=digest, expires_at=refresh_expires_at)
    if session.expires_at != refresh_expires_at:
        Session.objects.filter(pk=session.pk).update(expires_at=refresh_expires_at)
        session.expires_at = refresh_expires_at
    access, access_expires_at = issue_access_token(session.user_id, session.id)
    return {
        "access": access,
        "refresh": raw,
        "access_expires_at": iso(access_expires_at),
        "refresh_expires_at": iso(refresh_expires_at),
    }


def _revoke_events(session_ids: Iterable[uuid.UUID]) -> list[Event]:
    return [
        Event(group=session_group(sid), type="session.revoked", data={}, close_code=4004)
        for sid in session_ids
    ]


def revoke_sessions(sessions: Iterable[Session] | Any, *, reason: str) -> list[uuid.UUID]:
    """Revoke sessions, delete their push tokens and close their sockets (after commit)."""
    ids = [s.pk for s in sessions]
    if not ids:
        return []
    with transaction.atomic():
        Session.objects.filter(pk__in=ids, revoked_at__isnull=True).update(
            revoked_at=timezone.now(), revoke_reason=reason[:32]
        )
        PushToken.objects.filter(session_id__in=ids).delete()
        RefreshToken.objects.filter(session_id__in=ids, rotated_at__isnull=True).update(
            rotated_at=timezone.now()
        )
    mark_revoked(ids)
    emit_sync(_revoke_events(ids))
    log.info("sessions_revoked", count=len(ids), reason=reason)
    return ids


def create_session(user: User, device: DeviceInfo) -> tuple[Session, dict[str, Any]]:
    """Start a session for ``device``, replacing any active session of the same device."""
    with transaction.atomic():
        previous = list(
            Session.objects.select_for_update().filter(
                user=user, device_id=device.device_id, revoked_at__isnull=True
            )
        )
        if previous:
            Session.objects.filter(pk__in=[s.pk for s in previous]).update(
                revoked_at=timezone.now(), revoke_reason="replaced"
            )
            PushToken.objects.filter(session__in=previous).delete()
        session = Session.objects.create(
            user=user,
            device_id=device.device_id,
            platform=device.platform,
            device_name=device.name,
            app_version=device.app_version,
            expires_at=timezone.now() + settings.REFRESH_TOKEN_LIFETIME,
        )
        tokens = issue_tokens(session)
    if previous:
        mark_revoked([s.pk for s in previous])
        emit_sync(_revoke_events([s.pk for s in previous]))
    log.info(
        "session_created",
        user_id=str(user.id),
        session_id=str(session.id),
        platform=device.platform,
        replaced=len(previous),
    )
    return session, tokens


def register(
    *, username: str, display_name: str, password: str, email: str | None, device: DeviceInfo
) -> tuple[User, Session, dict[str, Any]]:
    username = username.lower()
    if User.objects.filter(username=username).exists():
        raise Conflict("That username is taken.", details={"username": ["username_taken"]})
    if email and User.objects.filter(email=email.lower()).exists():
        raise Conflict("That email is already in use.", details={"email": ["email_taken"]})
    try:
        with transaction.atomic():
            user = User.objects.create_user(
                username, password, display_name=display_name, email=email or None
            )
    except IntegrityError as exc:  # lost a race with a concurrent registration
        raise Conflict("That username is taken.", details={"username": ["username_taken"]}) from exc
    session, tokens = create_session(user, device)
    log.info("user_registered", user_id=str(user.id))
    return user, session, tokens


def authenticate_credentials(username: str, password: str) -> User:
    user = User.objects.filter(username=username.strip().lower()).first()
    if user is None:
        # Spend the same hashing time as a real check to avoid username probing.
        User(password=_DUMMY_PASSWORD_HASH).check_password(password)
        raise InvalidCredentials()
    if not user.check_password(password) or not user.is_active:
        raise InvalidCredentials()
    return user


def refresh(raw_token: str) -> dict[str, Any]:
    """Rotate a refresh token. Reuse of an already-rotated token revokes the whole session."""
    digest = hash_refresh_token(raw_token)
    found = RefreshToken.objects.filter(token_hash=digest).values_list("session_id", flat=True)
    session_id = next(iter(found), None)
    if session_id is None:
        raise AuthError("token_invalid", "Invalid refresh token.")

    decision = ratelimit.hit(("refresh_session", str(session_id)))
    if not decision.allowed:
        raise RateLimited(decision.retry_after_sec)

    reused = False
    with transaction.atomic():
        token = (
            RefreshToken.objects.select_for_update()
            .select_related("session", "session__user")
            .get(token_hash=digest)
        )
        session = token.session
        if session.revoked_at is not None or not session.user.is_active:
            raise AuthError("session_revoked", "This session has been revoked.")
        if token.rotated_at is not None:
            reused = True
        elif token.expires_at <= timezone.now() or session.expires_at <= timezone.now():
            raise AuthError("token_invalid", "Refresh token expired.")
        else:
            token.rotated_at = timezone.now()
            token.save(update_fields=["rotated_at"])
            Session.objects.filter(pk=session.pk).update(last_active_at=timezone.now())
            tokens = issue_tokens(session)
    if reused:
        log.warning(
            "refresh_token_reuse_detected", session_id=str(session.id), user_id=str(session.user_id)
        )
        revoke_sessions([session], reason="refresh_reuse")
        raise AuthError("session_revoked", "Refresh token reuse detected; session revoked.")
    return tokens


def change_password(user: User, *, new_password: str, keep_session_id: uuid.UUID) -> None:
    user.set_password(new_password)
    user.save(update_fields=["password"])
    others = Session.objects.filter(user=user, revoked_at__isnull=True).exclude(pk=keep_session_id)
    revoke_sessions(list(others), reason="password_changed")


def delete_account(user: User) -> None:
    """Hard-delete the account and everything owned by it.

    Sessions are revoked first (sockets get ``session.revoked`` + close 4004 and access tokens
    stop working immediately), live calls are ended, then the row is deleted and the database
    cascades to sessions, refresh/push tokens, conversations, messages and calls.
    """
    from apps.calls import services as call_services
    from apps.realtime import presence

    sessions = list(Session.objects.filter(user=user, revoked_at__isnull=True))
    revoke_sessions(sessions, reason="account_deleted")
    call_services.end_calls_for_user(user.id, reason="failed")
    user_id = user.id
    with transaction.atomic():
        User.objects.filter(pk=user_id).delete()
    presence.forget_user(user_id)
    log.info("account_deleted", user_id=str(user_id))
