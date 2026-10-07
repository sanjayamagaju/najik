"""Fan-out of server→client frames through the channel layer.

Groups:
- ``u.<user_hex>``     every connection of a user
- ``s.<session_hex>``  every connection of one session (normally exactly one)
- ``p.<user_hex>``     connections subscribed to a user's presence

Services build :class:`Event` objects and emit them *after* their transaction commits.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from apps.core.logging import get_logger

log = get_logger(__name__)


def user_group(user_id: uuid.UUID | str) -> str:
    return f"u.{uuid.UUID(str(user_id)).hex}"


def session_group(session_id: uuid.UUID | str) -> str:
    return f"s.{uuid.UUID(str(session_id)).hex}"


def presence_group(user_id: uuid.UUID | str) -> str:
    return f"p.{uuid.UUID(str(user_id)).hex}"


@dataclass(slots=True)
class Event:
    group: str
    type: str
    data: dict[str, Any] = field(default_factory=dict)
    # Skip delivery on connections that belong to this session.
    exclude_session: str | None = None
    # Deliver only to connections of this session (used on user groups).
    only_session: str | None = None
    # Receiving connection injects fresh `ice_servers` for its own user.
    attach_ice: bool = False
    # Receiving connection closes with this code after sending the frame.
    close_code: int | None = None

    def message(self) -> dict[str, Any]:
        return {
            "type": "rt.event",
            "frame": {"type": self.type, "data": self.data},
            "exclude_session": self.exclude_session,
            "only_session": self.only_session,
            "attach_ice": self.attach_ice,
            "close_code": self.close_code,
        }


async def emit(events: list[Event]) -> None:
    if not events:
        return
    layer = get_channel_layer()
    if layer is None:
        return
    for event in events:
        try:
            await layer.group_send(event.group, event.message())
        except Exception:  # never let fan-out failures break the request path
            log.exception("event_emit_failed", event_type=event.type)


def emit_sync(events: list[Event]) -> None:
    if events:
        async_to_sync(emit)(events)
