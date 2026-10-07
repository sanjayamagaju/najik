"""Celery application (worker + beat)."""

from celery import Celery
from celery.signals import setup_logging, worker_ready

from config.env import configure

configure()

app = Celery("najik")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@setup_logging.connect
def _keep_django_logging(**_: object) -> None:
    """Prevent Celery from hijacking the root logger; Django settings configure structlog."""


@worker_ready.connect
def _start_metrics_server(**_: object) -> None:
    from django.conf import settings

    if settings.METRICS_ENABLED:
        from apps.core.metrics import start_worker_metrics_server

        start_worker_metrics_server()
