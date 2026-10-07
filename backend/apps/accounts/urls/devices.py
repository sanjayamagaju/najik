from django.urls import path

from apps.accounts import views

urlpatterns = [
    path("push-token", views.PushTokenView.as_view(), name="devices-push-token"),
]
