"""Prometheus metrics. Multiprocess-aware when ``PROMETHEUS_MULTIPROC_DIR`` is set."""

from __future__ import annotations

import os

from django.http import HttpRequest, HttpResponse
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    REGISTRY,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
    multiprocess,
)

HTTP_REQUESTS = Counter("najik_http_requests_total", "HTTP requests", ["method", "route", "status"])
HTTP_LATENCY = Histogram(
    "najik_http_request_duration_seconds",
    "HTTP request latency",
    ["route"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
)
WS_CONNECTIONS = Gauge(
    "najik_ws_connections",
    "Open authenticated WebSocket connections",
    multiprocess_mode="livesum",
)
WS_CLOSES = Counter("najik_ws_closes_total", "WebSocket closes by code", ["code"])
WS_FRAMES = Counter("najik_ws_frames_total", "WebSocket client frames", ["type", "result"])
MESSAGES = Counter("najik_messages_total", "Messages created", ["kind"])
CALLS_STARTED = Counter("najik_calls_started_total", "Calls that started ringing", ["media"])
CALLS_ENDED = Counter("najik_calls_ended_total", "Calls ended by reason", ["reason"])
PUSH_RESULTS = Counter("najik_push_total", "Push deliveries", ["provider", "kind", "result"])
RATE_LIMITED = Counter("najik_rate_limited_total", "Rate-limited actions", ["rule"])

CALL_RTT = Histogram(
    "najik_call_rtt_ms", "Client-reported average RTT", buckets=(25, 50, 100, 150, 250, 400, 800)
)
CALL_JITTER = Histogram(
    "najik_call_jitter_ms", "Client-reported average jitter", buckets=(5, 10, 20, 30, 50, 100)
)
CALL_LOSS = Histogram(
    "najik_call_packet_loss_pct",
    "Client-reported average packet loss",
    buckets=(0.1, 0.5, 1, 2, 5, 10, 20),
)
CALL_BITRATE_DOWN = Histogram(
    "najik_call_bitrate_down_kbps",
    "Client-reported average downstream bitrate",
    buckets=(32, 64, 150, 300, 550, 900, 1800, 3500),
)
CALL_DURATION = Histogram(
    "najik_call_duration_seconds",
    "Client-reported call duration",
    buckets=(10, 30, 60, 180, 600, 1800, 3600),
)
CALL_RECONNECTS = Histogram(
    "najik_call_reconnects", "Client-reported ICE reconnects", buckets=(0, 1, 2, 3, 5, 10)
)


def observe_http(method: str, route: str, status: int, duration: float) -> None:
    HTTP_REQUESTS.labels(method, route, str(status)).inc()
    HTTP_LATENCY.labels(route).observe(duration)


def _registry() -> CollectorRegistry:
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry)  # type: ignore[no-untyped-call]
        return registry
    return REGISTRY


def metrics_view(request: HttpRequest) -> HttpResponse:
    return HttpResponse(generate_latest(_registry()), content_type=CONTENT_TYPE_LATEST)


def start_worker_metrics_server() -> None:
    from prometheus_client import start_http_server

    port = int(os.environ.get("WORKER_METRICS_PORT", "9808"))
    start_http_server(port, registry=_registry())
