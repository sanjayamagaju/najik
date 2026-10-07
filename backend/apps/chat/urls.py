from django.urls import path

from apps.chat import views

urlpatterns = [
    path("conversations", views.ConversationListView.as_view(), name="conversations"),
    path(
        "conversations/<uuid:conversation_id>",
        views.ConversationDetailView.as_view(),
        name="conversation-detail",
    ),
    path(
        "conversations/<uuid:conversation_id>/messages",
        views.MessageListView.as_view(),
        name="conversation-messages",
    ),
    path(
        "conversations/<uuid:conversation_id>/read",
        views.ReadView.as_view(),
        name="conversation-read",
    ),
    path(
        "conversations/<uuid:conversation_id>/ping",
        views.PingView.as_view(),
        name="conversation-ping",
    ),
    path("presence", views.PresenceView.as_view(), name="presence"),
]
