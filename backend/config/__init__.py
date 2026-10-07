"""Project configuration package. Importing it makes the Celery app available to Django."""

from .celery import app as celery_app

__all__ = ["celery_app"]
