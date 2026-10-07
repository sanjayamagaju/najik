"""Presence housekeeping."""

from __future__ import annotations

from celery import shared_task

from apps.realtime import services


@shared_task(ignore_result=True)
def sweep_presence() -> int:
    """Beat task (every 30 s): broadcast `offline` for users whose sockets died silently."""
    return services.sweep_presence()
