"""Distributed rate limiting (GCRA, a token-bucket equivalent) evaluated atomically in Redis.

Several rules can be checked in one round trip; a request is admitted only if *every* rule
admits it, and nothing is consumed when any rule rejects it.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from django.conf import settings

from apps.core.redis import ScriptCache, get_async_redis, get_redis, rkey

_GCRA = ScriptCache(
    """
local now = tonumber(ARGV[1])
local n = #KEYS
local retry = 0
local tats = {}
for i = 1, n do
  local interval = tonumber(ARGV[2 * i])
  local period = tonumber(ARGV[2 * i + 1])
  local tat = tonumber(redis.call('GET', KEYS[i]) or now)
  if tat < now then tat = now end
  local new_tat = tat + interval
  local allow_at = new_tat - period
  if now < allow_at then
    if allow_at - now > retry then retry = allow_at - now end
  end
  tats[i] = new_tat
end
if retry > 0 then
  return {0, math.ceil(retry)}
end
for i = 1, n do
  redis.call('SET', KEYS[i], tostring(tats[i]), 'PX', math.max(1, math.ceil(tats[i] - now)))
end
return {1, 0}
"""
)


@dataclass(frozen=True, slots=True)
class Rule:
    name: str
    limit: int
    period_sec: float

    @classmethod
    def named(cls, name: str) -> Rule:
        count, period = settings.RATE_LIMITS[name].split("/")
        return cls(name=name, limit=int(count), period_sec=float(period))


@dataclass(frozen=True, slots=True)
class Decision:
    allowed: bool
    retry_after_sec: int = 0


def _build(checks: list[tuple[str, str]], now_ms: float | None) -> tuple[list[str], list[str]]:
    now = now_ms if now_ms is not None else time.time() * 1000
    keys: list[str] = []
    args: list[str] = [repr(now)]
    for rule_name, subject in checks:
        rule = Rule.named(rule_name)
        period_ms = rule.period_sec * 1000
        keys.append(rkey("rl", rule.name, subject))
        args.extend([repr(period_ms / rule.limit), repr(period_ms)])
    return keys, args


def _decision(result: list[int]) -> Decision:
    allowed, retry_ms = int(result[0]), int(result[1])
    if allowed:
        return Decision(True)
    return Decision(False, max(1, -(-retry_ms // 1000)))


def hit(*checks: tuple[str, str], now_ms: float | None = None) -> Decision:
    """Consume one unit from every ``(rule_name, subject)`` pair (sync)."""
    client = get_redis()
    keys, args = _build(list(checks), now_ms)
    return _decision(_GCRA.for_client(client)(keys=keys, args=args))


async def ahit(*checks: tuple[str, str], now_ms: float | None = None) -> Decision:
    """Async variant of :func:`hit` for the WebSocket consumer."""
    client = get_async_redis()
    keys, args = _build(list(checks), now_ms)
    return _decision(await _GCRA.for_client(client)(keys=keys, args=args))
