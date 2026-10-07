"""Provider registry. ``PUSH_LOG_ONLY`` swaps every provider for a logger."""

from __future__ import annotations

import threading

from django.conf import settings

from apps.push.providers.base import PushMessage, PushProvider, PushResult
from apps.push.providers.log import LogOnlyProvider

_lock = threading.Lock()
_instances: dict[str, PushProvider] = {}

__all__ = ["PushMessage", "PushProvider", "PushResult", "get_provider", "reset_providers"]


def _create(name: str) -> PushProvider:
    if settings.PUSH_LOG_ONLY:
        return LogOnlyProvider(name)
    if name == "fcm":
        from apps.push.providers.fcm import FCMProvider

        return FCMProvider()
    if name in ("apns", "apns_voip"):
        from apps.push.providers.apns import APNsProvider

        return APNsProvider(name)
    raise ValueError(f"unknown push provider {name!r}")


def get_provider(name: str) -> PushProvider:
    provider = _instances.get(name)
    if provider is None:
        with _lock:
            provider = _instances.get(name)
            if provider is None:
                provider = _create(name)
                _instances[name] = provider
    return provider


def reset_providers() -> None:
    _instances.clear()
