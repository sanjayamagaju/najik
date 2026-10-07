"""Gunicorn config: uvicorn ASGI workers serving both HTTP and WebSocket traffic."""

import multiprocessing
import os

bind = os.environ.get("GUNICORN_BIND", "0.0.0.0:8000")
workers = int(os.environ.get("WEB_CONCURRENCY", max(2, multiprocessing.cpu_count())))
worker_class = "config.uvicorn_worker.NajikUvicornWorker"
# WebSockets are long-lived; graceful shutdown gives clients time to receive the close.
graceful_timeout = int(os.environ.get("GUNICORN_GRACEFUL_TIMEOUT", "30"))
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "60"))
keepalive = 5
max_requests = int(os.environ.get("GUNICORN_MAX_REQUESTS", "0"))
max_requests_jitter = int(os.environ.get("GUNICORN_MAX_REQUESTS_JITTER", "0"))
accesslog = None  # access logs come from AccessLogMiddleware (structured)
errorlog = "-"
loglevel = os.environ.get("GUNICORN_LOG_LEVEL", "info")
forwarded_allow_ips = os.environ.get("FORWARDED_ALLOW_IPS", "127.0.0.1")
# Heartbeat files on tmpfs avoid stalls on slow container filesystems.
worker_tmp_dir = "/dev/shm" if os.path.isdir("/dev/shm") else None  # noqa: S108


def child_exit(server, worker):
    """Clean up Prometheus multiprocess files of dead workers."""
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        from prometheus_client import multiprocess

        multiprocess.mark_process_dead(worker.pid)
