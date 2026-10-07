"""Firebase Cloud Messaging HTTP v1 provider (service-account OAuth2 via google-auth)."""

from __future__ import annotations

import base64
import json
import threading
from pathlib import Path
from typing import Any

import httpx
from django.conf import settings

from apps.core.logging import get_logger
from apps.push.providers.base import PushMessage, PushResult

log = get_logger(__name__)

SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
INVALID_TOKEN_CODES = {"UNREGISTERED", "SENDER_ID_MISMATCH"}


def _load_service_account() -> dict[str, Any]:
    if settings.FCM_CREDENTIALS_JSON:
        raw = settings.FCM_CREDENTIALS_JSON.strip()
        if not raw.startswith("{"):
            raw = base64.b64decode(raw).decode()
        return json.loads(raw)
    return json.loads(Path(settings.FCM_CREDENTIALS_FILE).read_text())


class FCMProvider:
    name = "fcm"

    def __init__(self) -> None:
        from google.oauth2 import service_account

        self._credentials = service_account.Credentials.from_service_account_info(
            _load_service_account(), scopes=[SCOPE]
        )
        self._lock = threading.Lock()
        self._url = (
            f"https://fcm.googleapis.com/v1/projects/{settings.FCM_PROJECT_ID}/messages:send"
        )
        self._client = httpx.Client(timeout=settings.PUSH_HTTP_TIMEOUT_SEC)

    def _access_token(self, *, force: bool = False) -> str:
        from google.auth.transport.requests import Request

        with self._lock:
            if force or not self._credentials.valid:
                self._credentials.refresh(Request())
            return str(self._credentials.token)

    @staticmethod
    def build(token: str, message: PushMessage) -> dict[str, Any]:
        android: dict[str, Any] = {"priority": "HIGH" if message.high_priority else "NORMAL"}
        if message.ttl_sec is not None:
            android["ttl"] = f"{int(message.ttl_sec)}s"
        if message.title is not None:
            notification: dict[str, Any] = {"title": message.title, "body": message.body or ""}
            if message.collapse_id:
                notification["tag"] = message.collapse_id
            if message.android_channel:
                notification["channel_id"] = message.android_channel
            android["notification"] = notification
        elif message.collapse_id:
            android["collapse_key"] = message.collapse_id
        return {"message": {"token": token, "data": message.data, "android": android}}

    def send(self, token: str, message: PushMessage) -> PushResult:
        body = self.build(token, message)
        try:
            response = self._post(body)
            if response.status_code == 401:
                response = self._post(body, force_refresh=True)
        except httpx.HTTPError as exc:
            log.warning("fcm_network_error", error=type(exc).__name__)
            return PushResult.RETRY
        return self.classify(response)

    def _post(self, body: dict[str, Any], *, force_refresh: bool = False) -> httpx.Response:
        headers = {"Authorization": f"Bearer {self._access_token(force=force_refresh)}"}
        return self._client.post(self._url, json=body, headers=headers)

    @staticmethod
    def classify(response: httpx.Response) -> PushResult:
        status = response.status_code
        if status == 200:
            return PushResult.OK
        codes: set[str] = set()
        try:
            error = response.json().get("error", {})
            codes.add(str(error.get("status", "")))
            for detail in error.get("details", []) or []:
                if "errorCode" in detail:
                    codes.add(str(detail["errorCode"]))
        except ValueError:
            pass
        if codes & INVALID_TOKEN_CODES or status == 404:
            return PushResult.INVALID_TOKEN
        if status == 400 and "INVALID_ARGUMENT" in codes:
            # Malformed registration tokens surface as INVALID_ARGUMENT.
            log.warning("fcm_invalid_argument")
            return PushResult.INVALID_TOKEN
        if status in (429, 500, 502, 503, 504):
            return PushResult.RETRY
        log.warning("fcm_send_failed", status=status, codes=sorted(codes))
        return PushResult.FAILED
