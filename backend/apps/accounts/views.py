"""Auth, session, profile, search and push-token endpoints."""

from __future__ import annotations

from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import Case, IntegerField, Q, Value, When
from django.db.models.functions import Length
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts import presenters, services
from apps.accounts.models import PushToken, Session, User
from apps.accounts.serializers import (
    EmptySerializer,
    LoginSerializer,
    PasswordChangeSerializer,
    PasswordConfirmSerializer,
    ProfileUpdateSerializer,
    PushTokenDeleteSerializer,
    PushTokenSerializer,
    RefreshSerializer,
    RegisterSerializer,
)
from apps.core import ratelimit
from apps.core.errors import Conflict, NotFound, RateLimited
from apps.core.logging import get_logger
from apps.core.net import client_ip
from apps.core.pagination import parse_limit

log = get_logger(__name__)


def _limit(*checks: tuple[str, str]) -> None:
    decision = ratelimit.hit(*checks)
    if not decision.allowed:
        from apps.core.metrics import RATE_LIMITED

        RATE_LIMITED.labels(checks[0][0]).inc()
        raise RateLimited(decision.retry_after_sec)


def _validated(serializer_cls: type, request: Request, **context: Any) -> Any:
    data = request.data if request.data is not None else {}
    serializer = serializer_cls(data=data, context=context)
    serializer.is_valid(raise_exception=True)
    return serializer


# ----------------------------------------------------------------------------------------
# Auth
# ----------------------------------------------------------------------------------------
class RegisterView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    def post(self, request: Request) -> Response:
        _limit(("register_ip", client_ip(request)))
        s = _validated(RegisterSerializer, request)
        data = s.validated_data
        user, _session, tokens = services.register(
            username=data["username"],
            display_name=data["display_name"],
            password=data["password"],
            email=data.get("email"),
            device=s.device_info(),
        )
        return Response({"user": presenters.me(user), "tokens": tokens}, status=201)


class LoginView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    def post(self, request: Request) -> Response:
        ip = client_ip(request)
        raw_username = request.data.get("username") if isinstance(request.data, dict) else None
        username_key = str(raw_username or "").strip().lower()[:64]
        _limit(("login_ip_user", f"{ip}|{username_key}"), ("login_ip", ip))
        s = _validated(LoginSerializer, request)
        user = services.authenticate_credentials(
            s.validated_data["username"], s.validated_data["password"]
        )
        _session, tokens = services.create_session(user, s.device_info())
        return Response({"user": presenters.me(user), "tokens": tokens})


class RefreshView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    def post(self, request: Request) -> Response:
        _limit(("refresh_ip", client_ip(request)))
        s = _validated(RefreshSerializer, request)
        tokens = services.refresh(s.validated_data["refresh"])
        return Response({"tokens": tokens})


class LogoutView(APIView):
    def post(self, request: Request) -> Response:
        _validated(EmptySerializer, request)
        session = Session.objects.filter(pk=request.auth.session_id).first()
        if session is not None:
            services.revoke_sessions([session], reason="logout")
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordView(APIView):
    def post(self, request: Request) -> Response:
        s = _validated(PasswordChangeSerializer, request, user=request.user)
        services.change_password(
            request.user,
            new_password=s.validated_data["new_password"],
            keep_session_id=request.auth.session_id,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class SessionListView(APIView):
    def get(self, request: Request) -> Response:
        sessions = Session.objects.filter(user=request.user, revoked_at__isnull=True).order_by(
            "-last_active_at"
        )
        return Response(
            {
                "results": [
                    presenters.session(s, current_session_id=request.auth.session_id)
                    for s in sessions
                    if s.is_active
                ]
            }
        )


class SessionDetailView(APIView):
    def delete(self, request: Request, session_id: Any) -> Response:
        session = Session.objects.filter(
            pk=session_id, user=request.user, revoked_at__isnull=True
        ).first()
        if session is None:
            raise NotFound()
        services.revoke_sessions([session], reason="revoked_by_user")
        return Response(status=status.HTTP_204_NO_CONTENT)


class RevokeOtherSessionsView(APIView):
    def post(self, request: Request) -> Response:
        others = Session.objects.filter(user=request.user, revoked_at__isnull=True).exclude(
            pk=request.auth.session_id
        )
        services.revoke_sessions(list(others), reason="revoked_by_user")
        return Response(status=status.HTTP_204_NO_CONTENT)


# ----------------------------------------------------------------------------------------
# Users
# ----------------------------------------------------------------------------------------
class MeView(APIView):
    def get(self, request: Request) -> Response:
        return Response(presenters.me(request.user))

    def patch(self, request: Request) -> Response:
        s = _validated(ProfileUpdateSerializer, request)
        user: User = request.user
        fields: list[str] = []
        for name, value in s.validated_data.items():
            setattr(user, name, value)
            fields.append(name)
        if (
            "email" in fields
            and user.email
            and User.objects.filter(email=user.email).exclude(pk=user.pk).exists()
        ):
            raise Conflict("That email is already in use.", details={"email": ["email_taken"]})
        if fields:
            try:
                with transaction.atomic():
                    user.save(update_fields=fields)
            except IntegrityError as exc:
                raise Conflict(
                    "That email is already in use.", details={"email": ["email_taken"]}
                ) from exc
        return Response(presenters.me(user))

    def delete(self, request: Request) -> Response:
        s = _validated(PasswordConfirmSerializer, request)
        if not request.user.check_password(s.validated_data["password"]):
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"password": ["Incorrect password."]})
        services.delete_account(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserSearchView(APIView):
    def get(self, request: Request) -> Response:
        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"q": ["Enter at least 2 characters."]})
        q = q[:48]
        limit = parse_limit(request.query_params.get("limit"), default=20, maximum=50)
        _limit(("search", str(request.user.id)))
        lowered = q.lower()
        users = (
            User.objects.filter(is_active=True)
            .filter(Q(username__startswith=lowered) | Q(display_name__istartswith=q))
            .exclude(pk=request.user.pk)
            .annotate(
                exact=Case(
                    When(username=lowered, then=Value(0)),
                    default=Value(1),
                    output_field=IntegerField(),
                ),
                ulen=Length("username"),
            )
            .order_by("exact", "ulen", "username")[:limit]
        )
        return Response({"results": [presenters.public_user(u) for u in users]})


class UserDetailView(APIView):
    def get(self, request: Request, user_id: Any) -> Response:
        user = User.objects.filter(pk=user_id, is_active=True).first()
        if user is None:
            raise NotFound()
        return Response(presenters.public_user(user))


# ----------------------------------------------------------------------------------------
# Devices / push tokens
# ----------------------------------------------------------------------------------------
class PushTokenView(APIView):
    def put(self, request: Request) -> Response:
        s = _validated(PushTokenSerializer, request)
        provider = s.validated_data["provider"]
        token = s.validated_data["token"]
        session_id = request.auth.session_id
        with transaction.atomic():
            # A token belongs to exactly one session (e.g. after re-login on the same device).
            PushToken.objects.filter(
                provider=provider, token_hash=PushToken.hash_token(token)
            ).exclude(session_id=session_id).delete()
            existing = (
                PushToken.objects.select_for_update()
                .filter(session_id=session_id, provider=provider)
                .first()
            )
            if existing is None:
                PushToken.objects.create(
                    session_id=session_id, user=request.user, provider=provider, token=token
                )
            elif existing.token != token:
                existing.token = token
                existing.save()
        log.info("push_token_registered", provider=provider, session_id=str(session_id))
        return Response(status=status.HTTP_204_NO_CONTENT)

    def delete(self, request: Request) -> Response:
        s = _validated(PushTokenDeleteSerializer, request)
        PushToken.objects.filter(
            session_id=request.auth.session_id, provider=s.validated_data["provider"]
        ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
