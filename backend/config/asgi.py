"""ASGI entrypoint: Django HTTP + Channels WebSocket (``/ws/v1/``)."""

from config.env import configure

configure()

from django.core.asgi import get_asgi_application  # noqa: E402

django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402

from apps.realtime.routing import websocket_urlpatterns  # noqa: E402

# No Origin/cookie auth on the socket: authentication is the first-frame bearer token, so
# cross-site WebSocket hijacking does not apply. Native apps do not send an Origin header.
application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": URLRouter(websocket_urlpatterns),
    }
)
