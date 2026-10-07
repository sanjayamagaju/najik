"""Redis clients (sync for views/Celery, asyncio for the WebSocket consumer).

When ``REDIS_URL`` is empty (development/tests) an in-process fakeredis server is shared by the
sync and async clients, so the code paths are identical to production.
"""

from __future__ import annotations

import asyncio
import threading
import weakref
from typing import TYPE_CHECKING, Any

import redis
import redis.asyncio as aioredis
from django.conf import settings

if TYPE_CHECKING:
    from collections.abc import Callable

_lock = threading.Lock()
_sync_client: redis.Redis | None = None
_async_clients: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, aioredis.Redis] = (
    weakref.WeakKeyDictionary()
)
_fake_server: Any = None


def _get_fake_server() -> Any:
    global _fake_server
    if _fake_server is None:
        import fakeredis

        _fake_server = fakeredis.FakeServer()
    return _fake_server


def get_redis() -> redis.Redis:
    """Process-wide synchronous client (thread-safe connection pool)."""
    global _sync_client
    if _sync_client is None:
        with _lock:
            if _sync_client is None:
                if settings.USE_FAKE_REDIS:
                    import fakeredis

                    _sync_client = fakeredis.FakeRedis(
                        server=_get_fake_server(), decode_responses=True
                    )
                else:
                    _sync_client = redis.Redis.from_url(
                        settings.REDIS_URL,
                        decode_responses=True,
                        socket_timeout=5,
                        socket_connect_timeout=5,
                        health_check_interval=30,
                    )
    return _sync_client


def get_async_redis() -> aioredis.Redis:
    """Asyncio client bound to the running event loop (one pool per loop)."""
    loop = asyncio.get_running_loop()
    client = _async_clients.get(loop)
    if client is None:
        if settings.USE_FAKE_REDIS:
            import fakeredis

            client = fakeredis.FakeAsyncRedis(server=_get_fake_server(), decode_responses=True)
        else:
            client = aioredis.Redis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                socket_timeout=5,
                socket_connect_timeout=5,
                health_check_interval=30,
            )
        _async_clients[loop] = client
    return client


def rkey(*parts: object) -> str:
    """Namespaced Redis key, e.g. ``rkey("call", call_id)`` -> ``nj:call:<id>``."""
    return settings.REDIS_KEY_PREFIX + ":".join(str(p) for p in parts)


class ScriptCache:
    """Registers a Lua script lazily per client (sync and async)."""

    def __init__(self, source: str) -> None:
        self.source = source
        self._scripts: weakref.WeakKeyDictionary[Any, Callable[..., Any]] = (
            weakref.WeakKeyDictionary()
        )

    def for_client(self, client: Any) -> Callable[..., Any]:
        script = self._scripts.get(client)
        if script is None:
            script = client.register_script(self.source)
            self._scripts[client] = script
        return script


def reset_clients_for_tests() -> None:
    """Flush the fake server and drop cached clients (tests only)."""
    global _sync_client
    if _fake_server is not None:
        get_redis().flushall()
    _async_clients.clear()
