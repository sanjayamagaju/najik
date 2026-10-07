"""Sentry initialisation with PII scrubbing."""

from __future__ import annotations

from typing import Any

from apps.core.logging import SENSITIVE_KEYS

_SENSITIVE_HEADERS = {"authorization", "cookie", "x-forwarded-for", "x-real-ip"}


def _scrub(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            k: ("[redacted]" if str(k).lower() in SENSITIVE_KEYS else _scrub(v))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    return value


def before_send(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any]:
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("data", None)  # request bodies may contain messages/passwords
        request.pop("cookies", None)
        request.pop("query_string", None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {
                k: ("[redacted]" if k.lower() in _SENSITIVE_HEADERS else v)
                for k, v in headers.items()
            }
    if "extra" in event:
        event["extra"] = _scrub(event["extra"])
    for exc in (event.get("exception") or {}).get("values", []) or []:
        for frame in (exc.get("stacktrace") or {}).get("frames", []) or []:
            if "vars" in frame:
                frame["vars"] = _scrub(frame["vars"])
    breadcrumbs = event.get("breadcrumbs")
    if isinstance(breadcrumbs, dict) and isinstance(breadcrumbs.get("values"), list):
        for crumb in breadcrumbs["values"]:
            if isinstance(crumb, dict) and "data" in crumb:
                crumb["data"] = _scrub(crumb["data"])
    return event


def init_sentry(*, dsn: str, environment: str, release: str, traces_sample_rate: float) -> None:
    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.django import DjangoIntegration

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,
        send_default_pii=False,
        traces_sample_rate=traces_sample_rate,
        integrations=[DjangoIntegration(), CeleryIntegration()],
        before_send=before_send,
        max_request_body_size="never",
        include_local_variables=False,
    )
