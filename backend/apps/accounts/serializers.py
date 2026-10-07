"""Input validation for account endpoints."""

from __future__ import annotations

import re
from typing import Any

from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.accounts.models import Platform, PushProvider, User
from apps.accounts.services import DeviceInfo
from apps.core.utils import clean_text

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.]{3,24}$")


class StrictSerializer(serializers.Serializer):
    """Rejects unknown fields instead of silently ignoring them."""

    def to_internal_value(self, data: Any) -> Any:
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError(
                    {name: ["Unknown field."] for name in sorted(unknown)}
                )
        return super().to_internal_value(data)


def validate_display_name(value: str) -> str:
    value = clean_text(value).replace("\n", " ").replace("\t", " ")
    if not 1 <= len(value) <= 48:
        raise serializers.ValidationError("Display name must be 1-48 characters.")
    return value


def device_from(d: dict[str, Any]) -> DeviceInfo:
    return DeviceInfo(
        device_id=d["device_id"],
        platform=d["platform"],
        name=clean_text(d["name"]),
        app_version=clean_text(d["app_version"]),
    )


class DeviceSerializer(StrictSerializer):
    device_id = serializers.UUIDField()
    platform = serializers.ChoiceField(choices=Platform.choices)
    name = serializers.CharField(max_length=64, allow_blank=True, trim_whitespace=True)
    app_version = serializers.CharField(max_length=32, allow_blank=True, trim_whitespace=True)


class RegisterSerializer(StrictSerializer):
    username = serializers.CharField(max_length=64, trim_whitespace=True)
    display_name = serializers.CharField(max_length=200, trim_whitespace=False)
    password = serializers.CharField(max_length=512, trim_whitespace=False)
    email = serializers.EmailField(required=False, allow_null=True, allow_blank=True)
    device = DeviceSerializer()

    def validate_username(self, value: str) -> str:
        if not USERNAME_RE.match(value):
            raise serializers.ValidationError(
                "3-24 characters: letters, digits, underscore and dot."
            )
        return value.lower()

    def validate_display_name(self, value: str) -> str:
        return validate_display_name(value)

    def validate_email(self, value: str | None) -> str | None:
        return value.lower() if value else None

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        password = attrs["password"]
        if not 8 <= len(password) <= 128:
            raise serializers.ValidationError({"password": ["Password must be 8-128 characters."]})
        candidate = User(
            username=attrs["username"], display_name=attrs["display_name"], email=attrs.get("email")
        )
        try:
            password_validation.validate_password(password, user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)}) from exc
        return attrs

    def device_info(self) -> DeviceInfo:
        return device_from(self.validated_data["device"])


class LoginSerializer(StrictSerializer):
    username = serializers.CharField(max_length=64, trim_whitespace=True)
    password = serializers.CharField(max_length=512, trim_whitespace=False)
    device = DeviceSerializer()

    def device_info(self) -> DeviceInfo:
        return device_from(self.validated_data["device"])


class RefreshSerializer(StrictSerializer):
    refresh = serializers.CharField(max_length=256)


class EmptySerializer(StrictSerializer):
    pass


class PasswordChangeSerializer(StrictSerializer):
    current_password = serializers.CharField(max_length=512, trim_whitespace=False)
    new_password = serializers.CharField(max_length=512, trim_whitespace=False)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        user: User = self.context["user"]
        if not user.check_password(attrs["current_password"]):
            raise serializers.ValidationError({"current_password": ["Incorrect password."]})
        new = attrs["new_password"]
        if not 8 <= len(new) <= 128:
            raise serializers.ValidationError(
                {"new_password": ["Password must be 8-128 characters."]}
            )
        try:
            password_validation.validate_password(new, user=user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"new_password": list(exc.messages)}) from exc
        return attrs


class ProfileUpdateSerializer(StrictSerializer):
    display_name = serializers.CharField(max_length=200, required=False, trim_whitespace=False)
    email = serializers.EmailField(required=False, allow_null=True, allow_blank=True)
    show_message_preview = serializers.BooleanField(required=False)

    def validate_display_name(self, value: str) -> str:
        return validate_display_name(value)

    def validate_email(self, value: str | None) -> str | None:
        return value.lower() if value else None


class PasswordConfirmSerializer(StrictSerializer):
    password = serializers.CharField(max_length=512, trim_whitespace=False)


class PushTokenSerializer(StrictSerializer):
    provider = serializers.ChoiceField(choices=PushProvider.choices)
    token = serializers.CharField(max_length=4096, trim_whitespace=True)

    def validate_token(self, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9_:\-.]{8,4096}", value):
            raise serializers.ValidationError("Malformed push token.")
        return value


class PushTokenDeleteSerializer(StrictSerializer):
    provider = serializers.ChoiceField(choices=PushProvider.choices)
