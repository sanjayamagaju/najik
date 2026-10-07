"""Small shared helpers: time formatting, UUIDv7, string sanitising."""

from __future__ import annotations

import os
import re
import time
import uuid
from datetime import UTC, datetime

# C0/C1 control characters except \t (0x09) and \n (0x0a). Zero-width joiners are kept because
# emoji sequences depend on them.
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")


def uuid7() -> uuid.UUID:
    """Time-ordered UUID (RFC 9562 version 7)."""
    unix_ts_ms = time.time_ns() // 1_000_000
    rand = int.from_bytes(os.urandom(10), "big")
    value = (unix_ts_ms & 0xFFFF_FFFF_FFFF) << 80
    value |= 0x7 << 76
    value |= ((rand >> 62) & 0x0FFF) << 64
    value |= 0b10 << 62
    value |= rand & 0x3FFF_FFFF_FFFF_FFFF
    return uuid.UUID(int=value)


def iso(dt: datetime | None) -> str | None:
    """ISO-8601 UTC with milliseconds and a ``Z`` suffix, e.g. ``2026-10-07T09:41:00.123Z``."""
    if dt is None:
        return None
    dt = dt.astimezone(UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def utcnow() -> datetime:
    return datetime.now(UTC)


def clean_text(value: str) -> str:
    """Strip control characters except ``\n`` and ``\t``, then trim whitespace."""
    return _CONTROL_CHARS.sub("", value).strip()


def parse_uuid(value: object) -> uuid.UUID | None:
    if isinstance(value, uuid.UUID):
        return value
    if not isinstance(value, str) or len(value) > 36:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return None
