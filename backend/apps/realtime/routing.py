from django.urls import path

from apps.realtime.consumer import RealtimeConsumer

websocket_urlpatterns = [
    path("ws/v1/", RealtimeConsumer.as_asgi()),
]
