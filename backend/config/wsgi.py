"""WSGI entrypoint (management/admin only; production serves HTTP and WS over ASGI)."""

from config.env import configure

configure()

from django.core.wsgi import get_wsgi_application  # noqa: E402

application = get_wsgi_application()
