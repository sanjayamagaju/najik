from django.urls import path

from apps.accounts import views

urlpatterns = [
    path("me", views.MeView.as_view(), name="users-me"),
    path("search", views.UserSearchView.as_view(), name="users-search"),
    path("<uuid:user_id>", views.UserDetailView.as_view(), name="users-detail"),
]
