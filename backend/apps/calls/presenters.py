"""JSON representation of calls."""

from __future__ import annotations

from typing import Any

from apps.calls.models import Call
from apps.core.utils import iso


def call(c: Call) -> dict[str, Any]:
    return {
        "id": str(c.id),
        "caller_id": str(c.caller_id),
        "callee_id": str(c.callee_id),
        "media": c.media,
        "state": c.state,
        "created_at": iso(c.created_at),
        "answered_at": iso(c.answered_at),
        "ended_at": iso(c.ended_at),
        "end_reason": c.end_reason or None,
    }
