"""Live call state in Redis (hot path for signalling) and call deadlines.

Postgres is authoritative for transitions (row lock on the call); Redis holds what every node
needs quickly and shares:

- ``call:<id>``        hash: caller_id, callee_id, caller_sid, callee_sid, state, media
- ``ucall:<user>``     busy claim, value = call id (SET NX => one live call per user)
- ``scall:<session>``  the call a session is bound to (for the reconnect grace period)
- ``call_deadlines``   zset ``"<kind>|<call_id>[|<session>]" -> due_ms`` (ring timeout, grace)
"""

from __future__ import annotations

import time
from typing import Any

from apps.calls.models import Call, CallState
from apps.core.redis import ScriptCache, get_async_redis, get_redis, rkey

RINGING_TTL_SEC = 180
ACTIVE_TTL_SEC = 12 * 3600
ENDED_TTL_SEC = 120

_COMPARE_AND_DELETE = ScriptCache(
    """
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
"""
)


def call_key(call_id: Any) -> str:
    return rkey("call", call_id)


def deadlines_key() -> str:
    return rkey("call_deadlines")


def _now_ms() -> int:
    return int(time.time() * 1000)


# --- live call hash ---------------------------------------------------------------------
def put_call(call: Call) -> None:
    ttl = {
        CallState.RINGING: RINGING_TTL_SEC,
        CallState.ACTIVE: ACTIVE_TTL_SEC,
    }.get(CallState(call.state), ENDED_TTL_SEC)
    pipe = get_redis().pipeline()
    pipe.hset(
        call_key(call.id),
        mapping={
            "caller_id": str(call.caller_id),
            "callee_id": str(call.callee_id),
            "caller_sid": str(call.caller_session_id or ""),
            "callee_sid": str(call.callee_session_id or ""),
            "state": call.state,
            "media": call.media,
        },
    )
    pipe.expire(call_key(call.id), ttl)
    pipe.execute()


def get_call(call_id: Any) -> dict[str, str]:
    return get_redis().hgetall(call_key(call_id))


async def aget_call(call_id: Any) -> dict[str, str]:
    return await get_async_redis().hgetall(call_key(call_id))


def is_live(call_id: Any) -> bool:
    return get_redis().hget(call_key(call_id), "state") in (CallState.RINGING, CallState.ACTIVE)


# --- busy claims -----------------------------------------------------------------------
def claim_user(user_id: Any, call_id: Any) -> bool:
    """Atomically mark ``user_id`` as in ``call_id``. Stale claims are taken over."""
    client = get_redis()
    key = rkey("ucall", user_id)
    if client.set(key, str(call_id), nx=True, ex=ACTIVE_TTL_SEC):
        return True
    current = client.get(key)
    if current == str(call_id):
        return True
    if current and not is_live(current):
        client.set(key, str(call_id), ex=ACTIVE_TTL_SEC)
        return True
    return False


def release_user(user_id: Any, call_id: Any) -> None:
    client = get_redis()
    _COMPARE_AND_DELETE.for_client(client)(keys=[rkey("ucall", user_id)], args=[str(call_id)])


def bind_session(session_id: Any, call_id: Any) -> None:
    get_redis().set(rkey("scall", session_id), str(call_id), ex=ACTIVE_TTL_SEC)


def unbind_session(session_id: Any, call_id: Any) -> None:
    if not session_id:
        return
    client = get_redis()
    _COMPARE_AND_DELETE.for_client(client)(keys=[rkey("scall", session_id)], args=[str(call_id)])


def session_call(session_id: Any) -> str | None:
    return get_redis().get(rkey("scall", session_id))


# --- deadlines -------------------------------------------------------------------------
def ring_member(call_id: Any) -> str:
    return f"ring|{call_id}"


def grace_member(call_id: Any, session_id: Any) -> str:
    return f"grace|{call_id}|{session_id}"


def schedule(member: str, delay_sec: float, *, only_if_absent: bool = False) -> int:
    """Store a deadline; returns its due time in ms."""
    due = _now_ms() + int(delay_sec * 1000)
    get_redis().zadd(deadlines_key(), {member: due}, nx=only_if_absent)
    return due


def cancel(member: str) -> bool:
    return bool(get_redis().zrem(deadlines_key(), member))


def deadline(member: str) -> float | None:
    return get_redis().zscore(deadlines_key(), member)


def due_members(now_ms: int, limit: int = 500) -> list[str]:
    return get_redis().zrangebyscore(deadlines_key(), "-inf", now_ms, start=0, num=limit)


def clear_call(call: Call) -> None:
    """Drop claims, bindings and deadlines of an ended call; keep a short-lived ended marker."""
    release_user(call.caller_id, call.id)
    release_user(call.callee_id, call.id)
    unbind_session(call.caller_session_id, call.id)
    unbind_session(call.callee_session_id, call.id)
    client = get_redis()
    members = [ring_member(call.id)]
    members += [
        grace_member(call.id, sid)
        for sid in (call.caller_session_id, call.callee_session_id)
        if sid
    ]
    client.zrem(deadlines_key(), *members)
    put_call(call)
