"""Development provider: logs push metadata (never the token or message text)."""

from __future__ import annotations

from apps.core.logging import get_logger
from apps.push.providers.base import PushMessage, PushResult

log = get_logger(__name__)


class LogOnlyProvider:
    def __init__(self, name: str) -> None:
        self.name = name

    def send(self, token: str, message: PushMessage) -> PushResult:
        log.info(
            "push_log_only",
            provider=self.name,
            kind=message.kind,
            data_keys=sorted(message.data),
            voip=message.voip,
            background=message.background,
        )
        return PushResult.OK
