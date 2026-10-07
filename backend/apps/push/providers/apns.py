"""Apple Push Notification service provider: token-based (ES256 JWT) auth over HTTP/2."""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any

import httpx
import jwt
from django.conf import settings

from apps.core.logging import get_logger
from apps.push.providers.base import PushMessage, PushResult

log = get_logger(__name__)

PRODUCTION_HOST = "https://api.push.apple.com"
SANDBOX_HOST = "https://api.sandbox.push.apple.com"
INVALID_TOKEN_REASONS = {"BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"}
JWT_MAX_AGE_SEC = 50 * 60  # Apple rejects provider tokens older than 1 h


class APNsProvider:
    def __init__(self, name: str = "apns") -> None:
        self.name = name
        key = settings.APNS_PRIVATE_KEY or Path(settings.APNS_PRIVATE_KEY_FILE).read_text()
        self._private_key = key.replace("\\n", "\n")
        self._lock = threading.Lock()
        self._jwt: str | None = None
        self._jwt_issued = 0.0
        self._host = SANDBOX_HOST if settings.APNS_USE_SANDBOX else PRODUCTION_HOST
        self._client = httpx.Client(http2=True, timeout=settings.PUSH_HTTP_TIMEOUT_SEC)

    def _provider_token(self, *, force: bool = False) -> str:
        with self._lock:
            now = time.time()
            if force or self._jwt is None or now - self._jwt_issued > JWT_MAX_AGE_SEC:
                self._jwt = jwt.encode(
                    {"iss": settings.APNS_TEAM_ID, "iat": int(now)},
                    self._private_key,
                    algorithm="ES256",
                    headers={"kid": settings.APNS_KEY_ID},
                )
                self._jwt_issued = now
            return self._jwt

    @staticmethod
    def build(message: PushMessage) -> tuple[dict[str, str], dict[str, Any]]:
        """Return ``(headers_without_auth, payload)``."""
        bundle = settings.APNS_BUNDLE_ID
        headers: dict[str, str] = {}
        aps: dict[str, Any] = {}
        if message.voip:
            headers["apns-push-type"] = "voip"
            headers["apns-topic"] = f"{bundle}.voip"
            headers["apns-priority"] = "10"
        elif message.background:
            headers["apns-push-type"] = "background"
            headers["apns-topic"] = bundle
            headers["apns-priority"] = "5"  # Apple requires 5 for background pushes
            aps["content-available"] = 1
        else:
            headers["apns-push-type"] = "alert"
            headers["apns-topic"] = bundle
            headers["apns-priority"] = "10" if message.high_priority else "5"
            aps["alert"] = {"title": message.title or "", "body": message.body or ""}
            aps["sound"] = "default"
            aps["mutable-content"] = 1
            if message.thread_id:
                aps["thread-id"] = message.thread_id
            if message.time_sensitive:
                aps["interruption-level"] = "time-sensitive"
        if message.expires_at is not None:
            headers["apns-expiration"] = str(int(message.expires_at))
        if message.collapse_id:
            headers["apns-collapse-id"] = message.collapse_id[:64]
        payload: dict[str, Any] = {**message.data}
        if aps:
            payload["aps"] = aps
        return headers, payload

    def send(self, token: str, message: PushMessage) -> PushResult:
        headers, payload = self.build(message)
        url = f"{self._host}/3/device/{token}"
        try:
            response = self._post(url, headers, payload)
            if response.status_code == 403 and self._reason(response) == "ExpiredProviderToken":
                response = self._post(url, headers, payload, force_refresh=True)
        except httpx.HTTPError as exc:
            log.warning("apns_network_error", error=type(exc).__name__)
            return PushResult.RETRY
        return self.classify(response)

    def _post(
        self,
        url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
        *,
        force_refresh: bool = False,
    ) -> httpx.Response:
        auth = {"authorization": f"bearer {self._provider_token(force=force_refresh)}"}
        return self._client.post(url, json=payload, headers={**headers, **auth})

    @staticmethod
    def _reason(response: httpx.Response) -> str:
        try:
            return str(response.json().get("reason", ""))
        except ValueError:
            return ""

    @classmethod
    def classify(cls, response: httpx.Response) -> PushResult:
        status = response.status_code
        if status == 200:
            return PushResult.OK
        reason = cls._reason(response)
        if status == 410 or reason in INVALID_TOKEN_REASONS:
            return PushResult.INVALID_TOKEN
        if status in (429, 500, 503) or reason in ("TooManyRequests", "InternalServerError"):
            return PushResult.RETRY
        log.warning("apns_send_failed", status=status, reason=reason)
        return PushResult.FAILED
