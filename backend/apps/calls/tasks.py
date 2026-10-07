"""Celery tasks enforcing call deadlines (idempotent)."""

from __future__ import annotations

from celery import shared_task

from apps.calls import services


@shared_task(ignore_result=True)
def enforce_call_deadline(member: str) -> bool:
    """Countdown task scheduled with each deadline; a no-op unless the deadline is due."""
    return services.enforce_deadline(member)


@shared_task(ignore_result=True)
def sweep_calls() -> int:
    """Beat backstop (every 5 s): due deadlines, stale ringing calls, lost participants."""
    return services.sweep()
