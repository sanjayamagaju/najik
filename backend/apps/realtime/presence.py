"""Connection registry and presence, held in Redis.

Per user and per session, live connections are sorted sets ``conn_id -> expiry_ms``. Entries
expire when a node dies (no heartbeat refresh), so state self-heals without a clean
disconnect. A user is *online* while at least one connection is ``active`` (foreground).

Online/offline transitions are computed atomically in a Lua script using the ``online`` set,
so exactly one node observes (and broadcasts) each transition.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from django.conf import settings

from apps.core.redis import ScriptCache, get_async_redis, get_redis, rkey
from apps.core.utils import iso

_UPDATE = ScriptCache(
    """
local conn = ARGV[1]
local now = tonumber(ARGV[2])
local exp = tonumber(ARGV[3])
local mode = ARGV[4]
local uid = ARGV[5]
local ttl = tonumber(ARGV[6])
for i = 1, 3 do redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now) end
if mode == 'remove' then
  for i = 1, 3 do redis.call('ZREM', KEYS[i], conn) end
elseif mode == 'active' or mode == 'background' then
  redis.call('ZADD', KEYS[1], exp, conn)
  redis.call('ZADD', KEYS[3], exp, conn)
  if mode == 'active' then
    redis.call('ZADD', KEYS[2], exp, conn)
  else
    redis.call('ZREM', KEYS[2], conn)
  end
  for i = 1, 3 do redis.call('EXPIRE', KEYS[i], ttl) end
end
local transition = 0
if redis.call('ZCARD', KEYS[2]) > 0 then
  if redis.call('SADD', KEYS[4], uid) == 1 then transition = 1 end
else
  if redis.call('SREM', KEYS[4], uid) == 1 then transition = -1 end
end
return {transition, redis.call('ZCARD', KEYS[3]), redis.call('ZCARD', KEYS[1])}
"""
)


@dataclass(frozen=True, slots=True)
class Update:
    transition: int  # 1 went online, -1 went offline, 0 unchanged
    session_connections: int
    user_connections: int


def connection_ttl_ms() -> int:
    return (2 * settings.WS_HEARTBEAT_SEC + 10) * 1000


def _keys(user_id: Any, session_id: Any) -> list[str]:
    return [
        rkey("uconn", user_id),
        rkey("uactive", user_id),
        rkey("sconn", session_id or "none"),
        rkey("online"),
    ]


def _args(conn_id: str, mode: str, user_id: Any, now_ms: float | None) -> list[str]:
    now = int(now_ms if now_ms is not None else time.time() * 1000)
    ttl_ms = connection_ttl_ms()
    return [conn_id, str(now), str(now + ttl_ms), mode, str(user_id), str(ttl_ms // 1000 + 60)]


async def aupdate(
    user_id: Any, session_id: Any, conn_id: str, mode: str, *, now_ms: float | None = None
) -> Update:
    """``mode``: ``active`` | ``background`` (register/refresh) or ``remove``."""
    client = get_async_redis()
    result = await _UPDATE.for_client(client)(
        keys=_keys(user_id, session_id), args=_args(conn_id, mode, user_id, now_ms)
    )
    return Update(int(result[0]), int(result[1]), int(result[2]))


def check(user_id: Any, *, now_ms: float | None = None) -> Update:
    """Prune expired connections of a user and report a resulting transition (sweeper)."""
    client = get_redis()
    result = _UPDATE.for_client(client)(
        keys=_keys(user_id, None), args=_args("-", "check", user_id, now_ms)
    )
    return Update(int(result[0]), int(result[1]), int(result[2]))


def _now_ms() -> int:
    return int(time.time() * 1000)


def has_active_connection(user_id: Any) -> bool:
    return bool(get_redis().zcount(rkey("uactive", user_id), _now_ms(), "+inf"))


def online_map(user_ids: Iterable[Any]) -> dict[str, bool]:
    ids = [str(u) for u in user_ids]
    if not ids:
        return {}
    pipe = get_redis().pipeline(transaction=False)
    now = _now_ms()
    for uid in ids:
        pipe.zcount(rkey("uactive", uid), now, "+inf")
    return {uid: bool(count) for uid, count in zip(ids, pipe.execute(), strict=True)}


def session_live_connections(session_id: Any) -> int:
    return int(get_redis().zcount(rkey("sconn", session_id), _now_ms(), "+inf"))


def online_user_ids() -> list[str]:
    return list(get_redis().smembers(rkey("online")))


def forget_user(user_id: uuid.UUID) -> None:
    client = get_redis()
    client.delete(rkey("uconn", user_id), rkey("uactive", user_id))
    client.srem(rkey("online"), str(user_id))


def presence_payload(user_id: Any, online: bool, last_seen_at: Any) -> dict[str, Any]:
    return {"user_id": str(user_id), "online": online, "last_seen_at": iso(last_seen_at)}


def presence_for(user_ids: list[Any]) -> list[dict[str, Any]]:
    """Presence objects for ``user_ids`` (callers must have authorised the ids)."""
    from apps.accounts.models import User

    if not user_ids:
        return []
    online = online_map(user_ids)
    users = User.objects.filter(pk__in=user_ids, is_active=True).only("id", "last_seen_at")
    return [presence_payload(u.id, online.get(str(u.id), False), u.last_seen_at) for u in users]
