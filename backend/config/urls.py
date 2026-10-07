"""Root URL configuration."""

from django.conf import settings
from django.contrib import admin
from django.urls import include, path

from apps.core import health
from apps.core.metrics import metrics_view

api_v1 = [
    path("auth/", include("apps.accounts.urls.auth")),
    path("users/", include("apps.accounts.urls.users")),
    path("devices/", include("apps.accounts.urls.devices")),
    path("", include("apps.chat.urls")),
    path("", include("apps.calls.urls")),
]

urlpatterns = [
    path("healthz", health.healthz, name="healthz"),
    path("readyz", health.readyz, name="readyz"),
    path("api/v1/", include(api_v1)),
]

if settings.METRICS_ENABLED:
    urlpatterns.append(path("metrics", metrics_view, name="metrics"))

if settings.ADMIN_URL:
    admin.site.site_header = "Najik admin"
    urlpatterns.append(path(settings.ADMIN_URL, admin.site.urls))

handler400 = "apps.core.errors.handler400"
handler403 = "apps.core.errors.handler403"
handler404 = "apps.core.errors.handler404"
handler500 = "apps.core.errors.handler500"
