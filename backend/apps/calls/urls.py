from django.urls import path

from apps.calls import views

urlpatterns = [
    path("calls", views.CallListView.as_view(), name="calls"),
    path("calls/ice-servers", views.IceServersView.as_view(), name="calls-ice-servers"),
    path("calls/<uuid:call_id>", views.CallDetailView.as_view(), name="call-detail"),
    path("calls/<uuid:call_id>/metrics", views.CallMetricsView.as_view(), name="call-metrics"),
]
