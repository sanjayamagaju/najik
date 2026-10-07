"""Opaque keyset cursors (stable under concurrent inserts, unlike offsets)."""

from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import Any

from rest_framework.exceptions import ValidationError


def encode_cursor(ts: datetime, pk: Any) -> str:
    raw = json.dumps([ts.isoformat(), str(pk)], separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        ts, pk = json.loads(base64.urlsafe_b64decode(padded.encode()))
        return datetime.fromisoformat(ts), str(pk)
    except Exception as exc:
        raise ValidationError({"cursor": ["Invalid cursor."]}) from exc


def parse_int(raw: str | None, field: str, *, minimum: int = 0) -> int | None:
    if raw in (None, ""):
        return None
    try:
        value = int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise ValidationError({field: ["Must be an integer."]}) from exc
    if value < minimum:
        raise ValidationError({field: [f"Must be at least {minimum}."]})
    return value


def parse_limit(raw: str | None, *, default: int, maximum: int) -> int:
    value = parse_int(raw, "limit", minimum=1)
    return default if value is None else min(value, maximum)
