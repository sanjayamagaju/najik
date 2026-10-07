"""Call deadline scheduling that works across multiple ASGI nodes.

A deadline is first written to Redis (``call_deadlines`` zset). It is then enforced by
whichever of these fires first — enforcement is idempotent (the DB row lock decides):

1. an in-process asyncio timer on the node that scheduled it (precise, no Celery needed),
2. optionally a Celery ``apply_async(countdown=...)`` task (``CALL_TIMERS_USE_CELERY``),
3. the Celery beat sweeper (every 5 s) as the backstop, e.g. after a node crash.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from channels.db import database_sync_to_async
from django.conf import settings

from apps.calls import state
from apps.core.logging import get_logger

log = get_logger(__name__)

_local_tasks: set[asyncio.Task[None]] = set()


@dataclass(frozen=True, slots=True)
class Timer:
    member: str
    delay_sec: float


def schedule(member: str, delay_sec: float, *, only_if_absent: bool = False) -> Timer:
    state.schedule(member, delay_sec, only_if_absent=only_if_absent)
    if settings.CALL_TIMERS_USE_CELERY:
        from apps.calls.tasks import enforce_call_deadline

        try:
            enforce_call_deadline.apply_async((member,), countdown=delay_sec + 0.25)
        except Exception:
            log.exception("call_timer_dispatch_failed", member=member)
    return Timer(member, delay_sec)


def start_local(timers: list[Timer]) -> None:
    """Start asyncio timers for ``timers``. Must be called from the running event loop."""
    for timer in timers:
        task = asyncio.get_running_loop().create_task(_run(timer))
        _local_tasks.add(task)
        task.add_done_callback(_local_tasks.discard)


async def _run(timer: Timer) -> None:
    from apps.calls.services import enforce_deadline

    try:
        await asyncio.sleep(timer.delay_sec + 0.05)
        await database_sync_to_async(enforce_deadline)(timer.member)
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("call_timer_failed", member=timer.member)


def cancel_local_timers() -> None:
    """Cancel pending in-process timers (graceful shutdown / tests)."""
    for task in list(_local_tasks):
        task.cancel()
    _local_tasks.clear()
