from __future__ import annotations

import uuid

import pytest

from tests.conftest import Login, make_user
from tests.test_auth import assert_error

pytestmark = pytest.mark.django_db


def test_me_get_and_patch():
    me = Login(make_user("arjun"))
    make_user("taken", email="taken@example.com")
    r = me.client.get("/api/v1/users/me")
    assert r.status_code == 200
    assert set(r.json()) == {
        "id",
        "username",
        "display_name",
        "avatar_color",
        "created_at",
        "email",
        "show_message_preview",
    }

    r = me.client.patch(
        "/api/v1/users/me",
        {"display_name": "  Arjun\u0007 K  ", "email": "A@B.co", "show_message_preview": False},
        format="json",
    )
    assert r.status_code == 200, r.content
    assert r.json()["display_name"] == "Arjun K"
    assert r.json()["email"] == "a@b.co"
    assert r.json()["show_message_preview"] is False

    r = me.client.patch("/api/v1/users/me", {"email": "TAKEN@example.com"}, format="json")
    assert_error(r, 409, "conflict")
    r = me.client.patch("/api/v1/users/me", {"email": None}, format="json")
    assert r.json()["email"] is None
    r = me.client.patch("/api/v1/users/me", {"username": "hacker"}, format="json")
    assert_error(r, 400, "validation_error")


def test_avatar_color_is_deterministic():
    from apps.accounts.models import avatar_color_for

    user = make_user("arjun")
    assert user.avatar_color == avatar_color_for(user.id)


def test_search_prefix_privacy_and_validation():
    me = Login(make_user("arjun", display_name="Arjun"))
    make_user("arya", display_name="Arya Stark")
    make_user("zed", display_name="Ari Gold")
    make_user("bob", display_name="Bob")
    inactive = make_user("arnold")
    inactive.is_active = False
    inactive.save()

    assert_error(me.client.get("/api/v1/users/search?q=a"), 400, "validation_error")
    r = me.client.get("/api/v1/users/search?q=AR")
    assert r.status_code == 200
    names = [u["username"] for u in r.json()["results"]]
    assert set(names) == {"arya", "zed"}  # excludes self and inactive users
    assert set(r.json()["results"][0]) == {
        "id",
        "username",
        "display_name",
        "avatar_color",
        "created_at",
    }  # no email
    r = me.client.get("/api/v1/users/search?q=bo&limit=1")
    assert [u["username"] for u in r.json()["results"]] == ["bob"]


def test_search_exact_match_first():
    me = Login(make_user("me"))
    make_user("arjunx")
    make_user("arj")
    r = me.client.get("/api/v1/users/search?q=arj")
    assert r.json()["results"][0]["username"] == "arj"


def test_search_rate_limited(settings):
    settings.RATE_LIMITS = {**settings.RATE_LIMITS, "search": "3/60"}
    me = Login(make_user("arjun"))
    for _ in range(3):
        assert me.client.get("/api/v1/users/search?q=ab").status_code == 200
    r = me.client.get("/api/v1/users/search?q=ab")
    assert_error(r, 429, "rate_limited")
    assert int(r["Retry-After"]) >= 1


def test_user_detail():
    me = Login(make_user("arjun"))
    bob = make_user("bob")
    r = me.client.get(f"/api/v1/users/{bob.id}")
    assert r.status_code == 200 and r.json()["username"] == "bob"
    assert_error(me.client.get(f"/api/v1/users/{uuid.uuid4()}"), 404, "not_found")


def test_push_token_upsert_and_delete():
    from apps.accounts.models import PushToken

    user = make_user("arjun")
    phone, tablet = Login(user), Login(user)
    r = phone.client.put(
        "/api/v1/devices/push-token", {"provider": "fcm", "token": "token-aaaa-1111"}, format="json"
    )
    assert r.status_code == 204
    phone.client.put(
        "/api/v1/devices/push-token", {"provider": "fcm", "token": "token-bbbb-2222"}, format="json"
    )
    assert PushToken.objects.get(session=phone.session, provider="fcm").token == "token-bbbb-2222"
    # The same device token registered from another session moves to that session.
    tablet.client.put(
        "/api/v1/devices/push-token", {"provider": "fcm", "token": "token-bbbb-2222"}, format="json"
    )
    assert PushToken.objects.count() == 1
    assert PushToken.objects.get().session_id == tablet.session.id
    r = phone.client.put(
        "/api/v1/devices/push-token", {"provider": "gcm", "token": "token-cccc"}, format="json"
    )
    assert_error(r, 400, "validation_error")
    r = tablet.client.delete("/api/v1/devices/push-token", {"provider": "fcm"}, format="json")
    assert r.status_code == 204
    assert PushToken.objects.count() == 0
