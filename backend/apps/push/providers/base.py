"""Push provider abstraction."""

from __future__ import annotations

import enum
from dataclasses import asdict, dataclass, field
from typing import Any, Protocol


class PushResult(enum.StrEnum):
    OK = "ok"
    INVALID_TOKEN = "invalid_token"  # delete the token
    RETRY = "retry"  # transient (429/5xx/network): retry with backoff
    FAILED = "failed"  # permanent for this message (payload/config problem)


@dataclass(slots=True)
class PushMessage:
    """Provider-neutral push. ``data`` values must be strings (FCM requirement)."""

    kind: str  # message | ping | call.incoming | call.ended
    data: dict[str, str]
    title: str | None = None
    body: str | None = None
    high_priority: bool = True
    ttl_sec: int | None = None
    expires_at: float | None = None  # unix seconds; do not deliver after this
    collapse_id: str | None = None  # FCM android.notification.tag / APNs apns-collapse-id
    thread_id: str | None = None  # APNs thread-id
    android_channel: str | None = None
    # APNs presentation
    voip: bool = False  # apns-push-type voip, topic <bundle>.voip
    background: bool = False  # content-available, apns-push-type background
    time_sensitive: bool = False
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> PushMessage:
        return cls(**raw)


class PushProvider(Protocol):
    name: str

    def send(self, token: str, message: PushMessage) -> PushResult: ...
