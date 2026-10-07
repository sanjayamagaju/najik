"""Production settings. Refuses to start when required configuration is missing."""

from django.core.exceptions import ImproperlyConfigured

from .base import *
from .base import env, setup_observability


def _require(name: str, value: object) -> None:
    if not value:
        raise ImproperlyConfigured(f"{name} must be set when DJANGO_ENV={DJANGO_ENV}")


_require("SECRET_KEY", SECRET_KEY)
if len(SECRET_KEY) < 50 or "insecure" in SECRET_KEY:
    raise ImproperlyConfigured("SECRET_KEY must be a random string of at least 50 characters")
_require("DATABASE_URL", env.str("DATABASE_URL", default=""))
if DATABASES["default"]["ENGINE"] != "django.db.backends.postgresql":
    raise ImproperlyConfigured("DATABASE_URL must point at PostgreSQL in production")
_require("REDIS_URL", REDIS_URL)
if USE_FAKE_REDIS:
    raise ImproperlyConfigured("REDIS_URL must point at a real Redis in production")
_require("ALLOWED_HOSTS", ALLOWED_HOSTS)
_require("TURN_SECRET", TURN_SECRET)
_require("TURN_URLS", TURN_URLS)
_require("STUN_URLS", STUN_URLS)

DEBUG = False
JWT_SIGNING_KEY = JWT_SIGNING_KEY or SECRET_KEY
CELERY_TASK_ALWAYS_EAGER = False

if not PUSH_LOG_ONLY:
    if not (FCM_PROJECT_ID and (FCM_CREDENTIALS_FILE or FCM_CREDENTIALS_JSON)):
        raise ImproperlyConfigured(
            "FCM_PROJECT_ID and FCM_CREDENTIALS_FILE/FCM_CREDENTIALS_JSON are required "
            "(or set PUSH_LOG_ONLY=true)"
        )
    if not (
        APNS_TEAM_ID
        and APNS_KEY_ID
        and APNS_BUNDLE_ID
        and (APNS_PRIVATE_KEY_FILE or APNS_PRIVATE_KEY)
    ):
        raise ImproperlyConfigured(
            "APNS_TEAM_ID, APNS_KEY_ID, APNS_BUNDLE_ID and APNS_PRIVATE_KEY(_FILE) are required "
            "(or set PUSH_LOG_ONLY=true)"
        )

# The admin is disabled unless ADMIN_URL is set explicitly (use an unguessable path).
ADMIN_URL = env.str("ADMIN_URL", default="")

# --- HTTPS / security headers (TLS terminates at Caddy, which sets X-Forwarded-Proto) ---
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
TRUSTED_PROXY_COUNT = env.int("TRUSTED_PROXY_COUNT", default=1)
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
SECURE_REDIRECT_EXEMPT = [r"^healthz$", r"^readyz$", r"^metrics$"]
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=31536000)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", default=True)
SECURE_HSTS_PRELOAD = env.bool("SECURE_HSTS_PRELOAD", default=False)
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_HTTPONLY = True
CSRF_TRUSTED_ORIGINS = env.list(
    "CSRF_TRUSTED_ORIGINS", default=[f"https://{h}" for h in ALLOWED_HOSTS if h != "*"]
)
X_FRAME_OPTIONS = "DENY"
if not SECURE_HSTS_PRELOAD:
    # Preload is opt-in on purpose: removal from browser preload lists takes months.
    SILENCED_SYSTEM_CHECKS = ["security.W021"]
DATA_UPLOAD_MAX_MEMORY_SIZE = 256 * 1024

setup_observability(log_json=env.bool("LOG_JSON", default=True), log_level=LOG_LEVEL)
