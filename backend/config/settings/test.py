"""pytest settings: SQLite, fakeredis, in-memory channel layer, eager Celery, log-only push."""

from .base import *
from .base import setup_observability

DEBUG = False
SECRET_KEY = "test-secret-key-0123456789abcdefghijklmnopqrstuvwxyz-0123456789"
JWT_SIGNING_KEY = "test-jwt-signing-key-0123456789abcdefghijklmnopqrstuvwxyz"
ALLOWED_HOSTS = ["testserver", "localhost"]

if DATABASES["default"]["ENGINE"] == "django.db.backends.sqlite3":
    DATABASES["default"] = {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / ".pytest-db.sqlite3",
        "TEST": {"NAME": BASE_DIR / ".pytest-test-db.sqlite3"},
        "OPTIONS": {"timeout": 20},
    }

REDIS_URL = "fakeredis://"
USE_FAKE_REDIS = True
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
CELERY_BROKER_URL = "memory://localhost/"
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
CALL_TIMERS_USE_CELERY = False

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
STORAGES["staticfiles"] = {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}

PUSH_LOG_ONLY = True
TURN_SECRET = "test-turn-secret"
TURN_URLS = [
    "turn:turn.example.com:3478?transport=udp",
    "turn:turn.example.com:3478?transport=tcp",
    "turns:turn.example.com:5349?transport=tcp",
]
STUN_URLS = ["stun:turn.example.com:3478"]
METRICS_ENABLED = True
WS_AUTH_TIMEOUT_SEC = 0.5
ADMIN_URL = "admin/"

setup_observability(log_json=False, log_level="WARNING")
