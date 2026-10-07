"""Users, per-device sessions, rotating refresh tokens and push tokens."""

from __future__ import annotations

import hashlib
import uuid
from typing import Any, ClassVar

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.core.utils import uuid7

AVATAR_COLORS = (
    "#7C5CFF",
    "#FF6B6B",
    "#20C997",
    "#FFA94D",
    "#4DABF7",
    "#F06595",
    "#51CF66",
    "#845EF7",
    "#FCC419",
    "#22B8CF",
    "#FF8787",
    "#5C7CFA",
)


def avatar_color_for(user_id: uuid.UUID) -> str:
    """Deterministic avatar colour derived from the user id."""
    digest = hashlib.sha256(user_id.bytes).digest()
    return AVATAR_COLORS[digest[0] % len(AVATAR_COLORS)]


class UserManager(BaseUserManager["User"]):
    use_in_migrations = True

    def create_user(self, username: str, password: str | None = None, **extra: Any) -> User:
        if not username:
            raise ValueError("username is required")
        extra.setdefault("display_name", username)
        email = extra.pop("email", None)
        user = self.model(
            username=username.strip().lower(),
            email=self.normalize_email(email).lower() if email else None,
            **extra,
        )
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, username: str, password: str | None = None, **extra: Any) -> User:
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        return self.create_user(username, password, **extra)

    def get_by_natural_key(self, username: str | None) -> User:
        return self.get(username=(username or "").lower())


class User(AbstractBaseUser, PermissionsMixin):
    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    # Stored lowercase; uniqueness is therefore case-insensitive.
    username = models.CharField(max_length=24, unique=True)
    display_name = models.CharField(max_length=48)
    email = models.EmailField(max_length=254, null=True, blank=True, unique=True)
    avatar_color = models.CharField(max_length=7, editable=False)
    show_message_preview = models.BooleanField(default=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    objects: ClassVar[UserManager] = UserManager()

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS: ClassVar[list[str]] = ["display_name"]

    class Meta:
        constraints: ClassVar = [
            models.CheckConstraint(
                condition=Q(username=models.functions.Lower("username")),
                name="user_username_lowercase",
            ),
        ]

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.username = self.username.lower()
        if self.email:
            self.email = self.email.lower()
        else:
            self.email = None
        if not self.avatar_color:
            self.avatar_color = avatar_color_for(self.id)
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.username


class Platform(models.TextChoices):
    IOS = "ios", "iOS"
    ANDROID = "android", "Android"


class Session(models.Model):
    """One login on one device. Owns a family of rotating refresh tokens."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="sessions")
    device_id = models.UUIDField()
    platform = models.CharField(max_length=16, choices=Platform.choices)
    device_name = models.CharField(max_length=64, blank=True)
    app_version = models.CharField(max_length=32, blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    last_active_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoke_reason = models.CharField(max_length=32, blank=True)

    class Meta:
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=["user", "device_id"],
                condition=Q(revoked_at__isnull=True),
                name="session_one_active_per_device",
            ),
        ]
        indexes: ClassVar = [
            models.Index(fields=["user", "revoked_at"], name="session_user_revoked_idx"),
            models.Index(fields=["expires_at"], name="session_expires_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} / {self.platform} {self.device_name}"

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None and self.expires_at > timezone.now()


class RefreshToken(models.Model):
    """A refresh token in a session's rotation chain. Only the SHA-256 hash is stored."""

    id = models.BigAutoField(primary_key=True)
    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name="refresh_tokens")
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    rotated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes: ClassVar = [
            models.Index(fields=["expires_at"], name="refresh_expires_idx"),
        ]

    def __str__(self) -> str:
        return f"refresh#{self.pk} for session {self.session_id}"


class PushProvider(models.TextChoices):
    FCM = "fcm", "FCM"
    APNS = "apns", "APNs"
    APNS_VOIP = "apns_voip", "APNs VoIP"


class PushToken(models.Model):
    """Push token bound to a session (deleted when the session is revoked)."""

    id = models.BigAutoField(primary_key=True)
    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name="push_tokens")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="push_tokens")
    provider = models.CharField(max_length=16, choices=PushProvider.choices)
    token = models.CharField(max_length=4096)
    token_hash = models.CharField(max_length=64, editable=False)
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=["session", "provider"], name="pushtoken_session_provider"
            ),
            models.UniqueConstraint(
                fields=["provider", "token_hash"], name="pushtoken_unique_token"
            ),
        ]
        indexes: ClassVar = [models.Index(fields=["user", "provider"], name="pushtoken_user_idx")]

    def __str__(self) -> str:
        return f"{self.provider} token for session {self.session_id}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.token_hash = self.hash_token(self.token)
        super().save(*args, **kwargs)

    @staticmethod
    def hash_token(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()
