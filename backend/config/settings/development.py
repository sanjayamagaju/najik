"""Local development. Falls back to SQLite, fakeredis and the in-memory channel layer."""

from .base import *
from .base import env, setup_observability

DEBUG = env.bool("DEBUG", default=True)
SECRET_KEY = SECRET_KEY or "dev-insecure-secret-key-change-me-0123456789abcdefghijklmnop"
JWT_SIGNING_KEY = JWT_SIGNING_KEY or SECRET_KEY
ALLOWED_HOSTS = ALLOWED_HOSTS or ["localhost", "127.0.0.1", "10.0.2.2", "*"]
PUSH_LOG_ONLY = env.bool("PUSH_LOG_ONLY", default=True)
TURN_SECRET = TURN_SECRET or "dev-turn-secret"
STUN_URLS = STUN_URLS or ["stun:stun.l.google.com:19302"]
METRICS_ENABLED = env.bool("METRICS_ENABLED", default=True)
STORAGES["staticfiles"] = {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}

setup_observability(log_json=env.bool("LOG_JSON", default=False), log_level=LOG_LEVEL)
