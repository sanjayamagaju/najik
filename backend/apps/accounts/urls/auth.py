from django.urls import path

from apps.accounts import views

urlpatterns = [
    path("register", views.RegisterView.as_view(), name="auth-register"),
    path("login", views.LoginView.as_view(), name="auth-login"),
    path("refresh", views.RefreshView.as_view(), name="auth-refresh"),
    path("logout", views.LogoutView.as_view(), name="auth-logout"),
    path("password", views.PasswordView.as_view(), name="auth-password"),
    path("sessions", views.SessionListView.as_view(), name="auth-sessions"),
    path(
        "sessions/revoke-others",
        views.RevokeOtherSessionsView.as_view(),
        name="auth-sessions-revoke-others",
    ),
    path("sessions/<uuid:session_id>", views.SessionDetailView.as_view(), name="auth-session"),
]
