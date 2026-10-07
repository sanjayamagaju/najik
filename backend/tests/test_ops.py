from __future__ import annotations

import pytest

from apps.core import ratelimit
from apps.core.logging import scrub_sensitive
from apps.core.sentry import before_send
from apps.core.utils import clean_text, iso, uuid7

pytestmark = pytest.mark.django_db


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_readyz_ok_and_degraded(client, monkeypatch):
    r = client.get("/readyz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "checks": {"db": "ok", "redis": "ok"}}

    class Broken:
        def ping(self):
            raise ConnectionError("down")

    monkeypatch.setattr("apps.core.health.get_redis", lambda: Broken())
    r = client.get("/readyz")
    assert r.status_code == 503
    assert r.json() == {"status": "degraded", "checks": {"db": "ok", "redis": "error"}}


def test_metrics_endpoint(client):
    client.get("/healthz")
    r = client.get("/metrics")
    assert r.status_code == 200
    assert b"najik_ws_connections" in r.content


def test_unknown_url_uses_error_shape(client):
    r = client.get("/api/v1/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


def test_method_not_allowed_shape(client):
    r = client.put("/api/v1/auth/login")
    assert r.status_code == 405
    assert r.json()["error"]["code"] == "method_not_allowed"


def test_request_id_is_echoed_or_generated(client):
    r = client.get("/healthz", HTTP_X_REQUEST_ID="abc12345-req")
    assert r["X-Request-ID"] == "abc12345-req"
    r = client.get("/healthz", HTTP_X_REQUEST_ID="bad id with spaces")
    assert r["X-Request-ID"] != "bad id with spaces" and len(r["X-Request-ID"]) == 32


def test_gcra_rate_limiter_semantics(settings):
    settings.RATE_LIMITS = {**settings.RATE_LIMITS, "t": "3/10"}
    now = 1_000_000.0
    results = [ratelimit.hit(("t", "k"), now_ms=now).allowed for _ in range(4)]
    assert results == [True, True, True, False]
    denied = ratelimit.hit(("t", "k"), now_ms=now)
    assert denied.retry_after_sec >= 3
    # One token comes back after period/limit.
    assert ratelimit.hit(("t", "k"), now_ms=now + 3400).allowed
    assert not ratelimit.hit(("t", "k"), now_ms=now + 3400).allowed
    # Subjects are independent.
    assert ratelimit.hit(("t", "other"), now_ms=now).allowed


def test_multi_rule_limit_consumes_nothing_on_rejection(settings):
    settings.RATE_LIMITS = {**settings.RATE_LIMITS, "a": "1/10", "b": "5/10"}
    now = 5_000_000.0
    assert ratelimit.hit(("a", "x"), ("b", "x"), now_ms=now).allowed
    for _ in range(3):
        assert not ratelimit.hit(("a", "x"), ("b", "x"), now_ms=now).allowed
    # Rule b still has 4 tokens: the rejected attempts did not consume from it.
    assert all(ratelimit.hit(("b", "x"), now_ms=now).allowed for _ in range(4))


def test_helpers():
    assert iso(None) is None
    u1, u2 = uuid7(), uuid7()
    assert u1.version == 7 and u1 != u2
    assert clean_text(" a\x00\x1bb\r\n\tc ") == "ab\n\tc"


def test_log_and_sentry_scrubbing():
    event = scrub_sensitive(None, "info", {"event": "x", "body": "secret", "token": "t", "ok": 1})
    assert event == {"event": "x", "body": "[redacted]", "token": "[redacted]", "ok": 1}
    sentry_event = {
        "request": {
            "data": {"password": "x"},
            "headers": {"Authorization": "Bearer t", "A": "b"},
            "cookies": {"c": 1},
            "query_string": "q=secret",
        },
        "extra": {"refresh": "r", "nested": {"sdp": "v=0"}},
    }
    out = before_send(sentry_event, {})
    assert "data" not in out["request"] and "cookies" not in out["request"]
    assert out["request"]["headers"] == {"Authorization": "[redacted]", "A": "b"}
    assert out["extra"] == {"refresh": "[redacted]", "nested": {"sdp": "[redacted]"}}
