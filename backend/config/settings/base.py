"""Settings shared by every environment.

Everything environment-specific is read from environment variables (see ``.env.example``).
Environment modules (development/staging/production/test) import this module and override.
"""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import environ

from apps.core.logging import build_logging_config, configure_structlog

BASE_DIR = Path(__file__).resolve().parents[2]

env = environ.Env()

DJANGO_ENV = env.str("DJANGO_ENV", default="development")
if DJANGO_ENV == "development" and (BASE_DIR / ".env").exists():
    environ.Env.read_env(BASE_DIR / ".env")

# --------------------------------------------------------------------------------------
# Core
# --------------------------------------------------------------------------------------
SECRET_KEY = env.str("SECRET_KEY", default="")
DEBUG = env.bool("DEBUG", default=False)
ALLOWED_HOSTS: list[str] = env.list("ALLOWED_HOSTS", default=[])
RELEASE = env.str("RELEASE", default="dev")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "channels",
    "apps.core",
    "apps.accounts",
    "apps.chat",
    "apps.calls",
    "apps.realtime",
    "apps.push",
]

MIDDLEWARE = [
    "apps.core.middleware.RequestIdMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "apps.core.middleware.AccessLogMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"
APPEND_SLASH = False

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# --------------------------------------------------------------------------------------
# Database
# --------------------------------------------------------------------------------------
DATABASES = {
    "default": env.db("DATABASE_URL", default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
}
if DATABASES["default"]["ENGINE"] == "django.db.backends.postgresql":
    # psycopg 3 connection pool (Django >= 5.1). Pooling replaces persistent connections,
    # which are unsafe under ASGI. Each worker process owns one pool.
    DATABASES["default"]["CONN_MAX_AGE"] = 0
    DATABASES["default"].setdefault("OPTIONS", {})
    if env.bool("DB_POOL", default=True):
        DATABASES["default"]["OPTIONS"]["pool"] = {
            "min_size": env.int("DB_POOL_MIN_SIZE", default=1),
            "max_size": env.int("DB_POOL_MAX_SIZE", default=10),
            "timeout": env.int("DB_POOL_TIMEOUT_SEC", default=10),
        }
    DATABASES["default"]["OPTIONS"].setdefault("connect_timeout", 5)
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --------------------------------------------------------------------------------------
# Redis / Channels / Celery
# --------------------------------------------------------------------------------------
# Empty REDIS_URL (development only) means an in-process fakeredis server.
REDIS_URL = env.str("REDIS_URL", default="")
REDIS_KEY_PREFIX = env.str("REDIS_KEY_PREFIX", default="nj:")
USE_FAKE_REDIS = REDIS_URL in ("", "fakeredis://")

if USE_FAKE_REDIS:
    CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.pubsub.RedisPubSubChannelLayer",
            "CONFIG": {
                "hosts": [env.str("CHANNEL_LAYER_REDIS_URL", default=REDIS_URL)],
                "prefix": "nj-ws",
            },
        }
    }

CELERY_BROKER_URL = env.str("CELERY_BROKER_URL", default=REDIS_URL or "memory://localhost/")
CELERY_RESULT_BACKEND = None
CELERY_TASK_IGNORE_RESULT = True
CELERY_TASK_ALWAYS_EAGER = env.bool("CELERY_TASK_ALWAYS_EAGER", default=USE_FAKE_REDIS)
CELERY_TASK_EAGER_PROPAGATES = False
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 4
CELERY_TASK_TIME_LIMIT = 60
CELERY_TASK_SOFT_TIME_LIMIT = 45
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
CELERY_BROKER_TRANSPORT_OPTIONS = {"visibility_timeout": 3600}
CELERY_TASK_DEFAULT_QUEUE = "default"
CELERY_TASK_ROUTES = {
    "apps.push.tasks.*": {"queue": "push"},
    "apps.calls.tasks.*": {"queue": "realtime"},
    "apps.realtime.tasks.*": {"queue": "realtime"},
}
CELERY_BEAT_SCHEDULE = {
    "calls-sweep": {"task": "apps.calls.tasks.sweep_calls", "schedule": 5.0},
    "presence-sweep": {"task": "apps.realtime.tasks.sweep_presence", "schedule": 30.0},
    "accounts-cleanup": {
        "task": "apps.accounts.tasks.cleanup_expired_tokens",
        "schedule": timedelta(hours=6),
    },
}

# --------------------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------------------
AUTH_USER_MODEL = "accounts.User"
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

JWT_SIGNING_KEY = env.str("JWT_SIGNING_KEY", default="")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_LIFETIME = timedelta(seconds=env.int("ACCESS_TOKEN_LIFETIME_SEC", default=15 * 60))
REFRESH_TOKEN_LIFETIME = timedelta(
    seconds=env.int("REFRESH_TOKEN_LIFETIME_SEC", default=30 * 24 * 3600)
)
JWT_LEEWAY_SEC = 5

# --------------------------------------------------------------------------------------
# REST framework
# --------------------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.accounts.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "EXCEPTION_HANDLER": "apps.core.errors.exception_handler",
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_THROTTLE_CLASSES": [],
}

# Rate limits (PROTOCOL.md §4.5). Format: "<count>/<seconds>". Enforced in Redis (GCRA).
RATE_LIMITS = {
    "login_ip_user": "5/60",
    "login_ip": "30/60",
    "register_ip": "5/3600",
    "refresh_session": "30/60",
    "refresh_ip": "120/60",
    "message_burst": "20/10",
    "message_hour": "600/3600",
    "typing": "20/10",
    "ping_pair": "1/5",
    "ping_hour": "30/3600",
    "call_invite": "6/60",
    "call_signal": "300/60",
    "search": "30/60",
    "presence_subscribe": "30/60",
    "ws_other": "120/10",
}
# A WebSocket connection that is rate-limited this many times within a minute is closed (4008).
WS_ABUSE_CLOSE_THRESHOLD = env.int("WS_ABUSE_CLOSE_THRESHOLD", default=20)

# Number of reverse proxies in front of the app whose X-Forwarded-For entries are trusted.
# The uvicorn worker also applies proxy headers from FORWARDED_ALLOW_IPS.
TRUSTED_PROXY_COUNT = env.int("TRUSTED_PROXY_COUNT", default=0)

# --------------------------------------------------------------------------------------
# Realtime
# --------------------------------------------------------------------------------------
WS_HEARTBEAT_SEC = env.int("WS_HEARTBEAT_SEC", default=25)
WS_AUTH_TIMEOUT_SEC = env.float("WS_AUTH_TIMEOUT_SEC", default=10.0)
WS_MAX_FRAME_BYTES = 64 * 1024
CALL_RING_TIMEOUT_SEC = env.float("CALL_RING_TIMEOUT_SEC", default=45.0)
CALL_RECONNECT_GRACE_SEC = env.float("CALL_RECONNECT_GRACE_SEC", default=30.0)
# Also dispatch Celery countdown tasks for call deadlines (in addition to the in-process
# asyncio timer and the beat sweeper). Requires a running worker.
CALL_TIMERS_USE_CELERY = env.bool("CALL_TIMERS_USE_CELERY", default=not USE_FAKE_REDIS)

# --------------------------------------------------------------------------------------
# TURN / STUN (TURN REST API, coturn `use-auth-secret`)
# --------------------------------------------------------------------------------------
TURN_SECRET = env.str("TURN_SECRET", default="")
TURN_URLS: list[str] = env.list("TURN_URLS", default=[])
STUN_URLS: list[str] = env.list("STUN_URLS", default=[])
TURN_CREDENTIAL_TTL_SEC = env.int("TURN_CREDENTIAL_TTL_SEC", default=3600)

# --------------------------------------------------------------------------------------
# Push
# --------------------------------------------------------------------------------------
PUSH_LOG_ONLY = env.bool("PUSH_LOG_ONLY", default=False)
FCM_PROJECT_ID = env.str("FCM_PROJECT_ID", default="")
# Either a path to the service-account JSON file or the JSON itself (base64 allowed).
FCM_CREDENTIALS_FILE = env.str("FCM_CREDENTIALS_FILE", default="")
FCM_CREDENTIALS_JSON = env.str("FCM_CREDENTIALS_JSON", default="")
FCM_ANDROID_CHANNEL_MESSAGES = env.str("FCM_ANDROID_CHANNEL_MESSAGES", default="messages")
FCM_ANDROID_CHANNEL_PINGS = env.str("FCM_ANDROID_CHANNEL_PINGS", default="pings")
APNS_TEAM_ID = env.str("APNS_TEAM_ID", default="")
APNS_KEY_ID = env.str("APNS_KEY_ID", default="")
APNS_PRIVATE_KEY_FILE = env.str("APNS_PRIVATE_KEY_FILE", default="")
APNS_PRIVATE_KEY = env.str("APNS_PRIVATE_KEY", default="")
APNS_BUNDLE_ID = env.str("APNS_BUNDLE_ID", default="")
APNS_USE_SANDBOX = env.bool("APNS_USE_SANDBOX", default=False)
PUSH_HTTP_TIMEOUT_SEC = env.float("PUSH_HTTP_TIMEOUT_SEC", default=10.0)

# --------------------------------------------------------------------------------------
# Admin / static / i18n
# --------------------------------------------------------------------------------------
# Empty ADMIN_URL disables the admin entirely.
ADMIN_URL = env.str("ADMIN_URL", default="admin/")
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# --------------------------------------------------------------------------------------
# Observability
# --------------------------------------------------------------------------------------
METRICS_ENABLED = env.bool("METRICS_ENABLED", default=False)
LOG_LEVEL = env.str("LOG_LEVEL", default="INFO")
LOG_JSON = env.bool("LOG_JSON", default=True)
SENTRY_DSN = env.str("SENTRY_DSN", default="")
SENTRY_TRACES_SAMPLE_RATE = env.float("SENTRY_TRACES_SAMPLE_RATE", default=0.0)

LOGGING_CONFIG = None  # configured explicitly below (and re-configured by env modules)


def setup_observability(*, log_json: bool, log_level: str) -> None:
    """Configure logging and Sentry. Called at the end of each environment module."""
    import logging.config

    configure_structlog()
    logging.config.dictConfig(build_logging_config(json=log_json, level=log_level))
    if SENTRY_DSN:
        from apps.core.sentry import init_sentry

        init_sentry(
            dsn=SENTRY_DSN,
            environment=DJANGO_ENV,
            release=RELEASE,
            traces_sample_rate=SENTRY_TRACES_SAMPLE_RATE,
        )
