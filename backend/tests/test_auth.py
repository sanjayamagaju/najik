from __future__ import annotations

import uuid
from datetime import timedelta

import jwt
import pytest
from django.conf import settings
from django.utils import timezone

from apps.accounts.models import PushToken, RefreshToken, Session, User
from apps.accounts.tokens import decode_access_token
from apps.chat.models import Conversation, Message
from tests.conftest import PASSWORD, Login, device_json, make_user

pytestmark = pytest.mark.django_db


def register(api, username="Arjun_1", **overrides):
    body = {
        "username": username,
        "display_name": "  Arjun  ",
        "password": PASSWORD,
        "device": device_json(),
    }
    body.update(overrides)
    return api.post("/api/v1/auth/register", body, format="json")


def assert_error(response, status, code):
    assert response.status_code == status, response.content
    body = response.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == code
    assert isinstance(body["error"]["message"], str)
    assert isinstance(body["error"]["details"], dict)
    return body["error"]


# --- register ---------------------------------------------------------------------------
def test_register_returns_me_and_tokens(api):
    r = register(api, email="Arjun@Example.com")
    assert r.status_code == 201, r.content
    body = r.json()
    user = body["user"]
    assert user["username"] == "arjun_1"
    assert user["display_name"] == "Arjun"
    assert user["email"] == "arjun@example.com"
    assert user["avatar_color"].startswith("#") and len(user["avatar_color"]) == 7
    assert user["created_at"].endswith("Z") and len(user["created_at"]) == 24
    tokens = body["tokens"]
    assert set(tokens) == {"access", "refresh", "access_expires_at", "refresh_expires_at"}
    claims = jwt.decode(tokens["access"], options={"verify_signature": False})
    assert set(claims) == {"sub", "sid", "jti", "exp", "iat", "type"}
    assert claims["type"] == "access" and claims["sub"] == user["id"]
    assert claims["exp"] - claims["iat"] == 15 * 60
    # Refresh token is stored only as a hash.
    assert not RefreshToken.objects.filter(token_hash=tokens["refresh"]).exists()


def test_register_username_is_case_insensitive_unique(api):
    assert register(api, "Arjun").status_code == 201
    err = assert_error(register(api, "ARJUN"), 409, "conflict")
    assert err["details"] == {"username": ["username_taken"]}


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"username": "ab"}, "username"),
        ({"username": "bad name"}, "username"),
        ({"username": "x" * 25}, "username"),
        ({"display_name": "   "}, "display_name"),
        ({"display_name": "x" * 49}, "display_name"),
        ({"password": "short1!"}, "password"),
        ({"password": "password123"}, "password"),
        ({"password": "x" * 129}, "password"),
        ({"email": "not-an-email"}, "email"),
        (
            {"device": {"device_id": "nope", "platform": "ios", "name": "", "app_version": ""}},
            "device",
        ),
        ({"device": {**device_json(), "platform": "windows"}}, "device"),
        ({"surprise": 1}, "surprise"),
    ],
)
def test_register_validation_errors(api, overrides, field):
    err = assert_error(register(api, **overrides), 400, "validation_error")
    assert field in err["details"]


def test_register_rejects_non_json_body(api):
    r = api.post("/api/v1/auth/register", "garbage", content_type="text/plain")
    assert_error(r, 415, "unsupported_media_type")
    r = api.post("/api/v1/auth/register", "{bad json", content_type="application/json")
    assert_error(r, 400, "validation_error")


def test_register_is_throttled_per_ip(api):
    for i in range(5):
        assert register(api, f"user{i}").status_code == 201
    r = register(api, "user99")
    assert_error(r, 429, "rate_limited")
    assert int(r["Retry-After"]) >= 1


# --- login ------------------------------------------------------------------------------
def test_login_success_and_failure(api):
    make_user("arjun")
    r = api.post(
        "/api/v1/auth/login",
        {"username": "ARJUN", "password": PASSWORD, "device": device_json()},
        format="json",
    )
    assert r.status_code == 200
    assert r.json()["user"]["username"] == "arjun"
    r = api.post(
        "/api/v1/auth/login",
        {"username": "arjun", "password": "wrong-password", "device": device_json()},
        format="json",
    )
    assert_error(r, 401, "invalid_credentials")
    r = api.post(
        "/api/v1/auth/login",
        {"username": "nobody", "password": "wrong-password", "device": device_json()},
        format="json",
    )
    assert_error(r, 401, "invalid_credentials")


def test_login_is_throttled_per_ip_and_username(api):
    make_user("arjun")
    body = {"username": "arjun", "password": "nope-nope-nope", "device": device_json()}
    for _ in range(5):
        assert api.post("/api/v1/auth/login", body, format="json").status_code == 401
    r = api.post("/api/v1/auth/login", body, format="json")
    assert_error(r, 429, "rate_limited")
    assert "Retry-After" in r
    # Another username from the same IP is still allowed (until 30/min per IP).
    other = {**body, "username": "someone"}
    assert api.post("/api/v1/auth/login", other, format="json").status_code == 401


def test_login_same_device_replaces_previous_session(api):
    make_user("arjun")
    dev = device_json()
    body = {"username": "arjun", "password": PASSWORD, "device": dev}
    first = api.post("/api/v1/auth/login", body, format="json").json()["tokens"]
    second = api.post("/api/v1/auth/login", body, format="json").json()["tokens"]
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {first['access']}")
    assert_error(api.get("/api/v1/users/me"), 401, "session_revoked")
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {second['access']}")
    assert api.get("/api/v1/users/me").status_code == 200
    assert Session.objects.filter(revoked_at__isnull=True).count() == 1


# --- tokens -----------------------------------------------------------------------------
def test_refresh_rotates_and_reuse_revokes_session(api):
    login = Login(make_user("arjun"))
    old = login.tokens["refresh"]
    r = api.post("/api/v1/auth/refresh", {"refresh": old}, format="json")
    assert r.status_code == 200
    new = r.json()["tokens"]
    assert new["refresh"] != old and new["access"] != login.access
    assert decode_access_token(new["access"]).session_id == login.session.id

    # Presenting the rotated token again is a reuse: the whole session is revoked.
    assert_error(
        api.post("/api/v1/auth/refresh", {"refresh": old}, format="json"), 401, "session_revoked"
    )
    assert_error(
        api.post("/api/v1/auth/refresh", {"refresh": new["refresh"]}, format="json"),
        401,
        "session_revoked",
    )
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {new['access']}")
    assert_error(api.get("/api/v1/users/me"), 401, "session_revoked")
    assert Session.objects.get(pk=login.session.pk).revoke_reason == "refresh_reuse"


def test_refresh_unknown_and_expired(api):
    assert_error(
        api.post("/api/v1/auth/refresh", {"refresh": "nope"}, format="json"), 401, "token_invalid"
    )
    login = Login(make_user("arjun"))
    RefreshToken.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    assert_error(
        api.post("/api/v1/auth/refresh", {"refresh": login.tokens["refresh"]}, format="json"),
        401,
        "token_invalid",
    )


def test_refresh_is_rate_limited_per_session(api, settings):
    settings.RATE_LIMITS = {**settings.RATE_LIMITS, "refresh_session": "2/60"}
    login = Login(make_user("arjun"))
    token = login.tokens["refresh"]
    for _ in range(2):
        token = api.post("/api/v1/auth/refresh", {"refresh": token}, format="json").json()[
            "tokens"
        ]["refresh"]
    assert_error(
        api.post("/api/v1/auth/refresh", {"refresh": token}, format="json"), 429, "rate_limited"
    )


def test_access_token_errors(api):
    login = Login(make_user("arjun"))
    assert_error(api.get("/api/v1/users/me"), 401, "not_authenticated")
    api.credentials(HTTP_AUTHORIZATION="Bearer not.a.jwt")
    assert_error(api.get("/api/v1/users/me"), 401, "token_invalid")
    api.credentials(HTTP_AUTHORIZATION="Basic abc")
    assert_error(api.get("/api/v1/users/me"), 401, "token_invalid")
    expired = jwt.encode(
        {
            "sub": str(login.user.id),
            "sid": str(login.session.id),
            "jti": "x",
            "iat": 1,
            "exp": 2,
            "type": "access",
        },
        settings.JWT_SIGNING_KEY,
        algorithm="HS256",
    )
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {expired}")
    assert_error(api.get("/api/v1/users/me"), 401, "token_expired")
    forged = jwt.encode({"sub": "x"}, "wrong-key-wrong-key-wrong-key-wrong-key", algorithm="HS256")
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {forged}")
    assert_error(api.get("/api/v1/users/me"), 401, "token_invalid")


# --- sessions ---------------------------------------------------------------------------
def test_logout_revokes_current_session():
    login = Login(make_user("arjun"))
    PushToken.objects.create(
        session=login.session, user=login.user, provider="fcm", token="fcm-token-123456"
    )
    assert login.client.post("/api/v1/auth/logout", {}, format="json").status_code == 204
    assert_error(login.client.get("/api/v1/users/me"), 401, "session_revoked")
    assert not PushToken.objects.exists()


def test_sessions_list_and_revoke():
    user = make_user("arjun")
    phone, tablet, laptop = Login(user), Login(user, "ios"), Login(user)
    r = phone.client.get("/api/v1/auth/sessions")
    assert r.status_code == 200
    results = r.json()["results"]
    assert len(results) == 3
    current = [s for s in results if s["current"]]
    assert len(current) == 1 and current[0]["id"] == str(phone.session.id)
    assert set(results[0]) == {
        "id",
        "device_name",
        "platform",
        "app_version",
        "created_at",
        "last_active_at",
        "ip_country",
        "current",
    }

    r = phone.client.delete(f"/api/v1/auth/sessions/{tablet.session.id}")
    assert r.status_code == 204
    assert_error(tablet.client.get("/api/v1/users/me"), 401, "session_revoked")
    assert_error(phone.client.delete(f"/api/v1/auth/sessions/{uuid.uuid4()}"), 404, "not_found")

    other_user = Login(make_user("other"))
    assert_error(
        phone.client.delete(f"/api/v1/auth/sessions/{other_user.session.id}"), 404, "not_found"
    )

    assert phone.client.post("/api/v1/auth/sessions/revoke-others").status_code == 204
    assert_error(laptop.client.get("/api/v1/users/me"), 401, "session_revoked")
    assert phone.client.get("/api/v1/users/me").status_code == 200
    assert other_user.client.get("/api/v1/users/me").status_code == 200


def test_password_change_revokes_other_sessions(api):
    user = make_user("arjun")
    phone, tablet = Login(user), Login(user)
    r = phone.client.post(
        "/api/v1/auth/password",
        {"current_password": "wrong", "new_password": "An0ther-Secret!"},
        format="json",
    )
    assert "current_password" in assert_error(r, 400, "validation_error")["details"]
    r = phone.client.post(
        "/api/v1/auth/password",
        {"current_password": PASSWORD, "new_password": "123"},
        format="json",
    )
    assert "new_password" in assert_error(r, 400, "validation_error")["details"]
    r = phone.client.post(
        "/api/v1/auth/password",
        {"current_password": PASSWORD, "new_password": "An0ther-Secret!"},
        format="json",
    )
    assert r.status_code == 204
    assert phone.client.get("/api/v1/users/me").status_code == 200
    assert_error(tablet.client.get("/api/v1/users/me"), 401, "session_revoked")
    r = api.post(
        "/api/v1/auth/login",
        {"username": "arjun", "password": "An0ther-Secret!", "device": device_json()},
        format="json",
    )
    assert r.status_code == 200


# --- account deletion -------------------------------------------------------------------
def test_delete_account(api):
    me = Login(make_user("arjun"))
    peer = Login(make_user("peer"))
    r = me.client.post("/api/v1/conversations", {"user_id": str(peer.user.id)}, format="json")
    conv_id = r.json()["id"]
    me.client.post(
        f"/api/v1/conversations/{conv_id}/messages",
        {"client_id": str(uuid.uuid4()), "body": "hi"},
        format="json",
    )
    PushToken.objects.create(
        session=me.session, user=me.user, provider="fcm", token="tok-123456789"
    )

    r = me.client.delete("/api/v1/users/me", {"password": "nope"}, format="json")
    assert "password" in assert_error(r, 400, "validation_error")["details"]
    r = me.client.delete("/api/v1/users/me", {"password": PASSWORD}, format="json")
    assert r.status_code == 204

    assert not User.objects.filter(username="arjun").exists()
    assert not Session.objects.filter(user_id=me.user.id).exists()
    assert not PushToken.objects.exists()
    assert not Conversation.objects.exists() and not Message.objects.exists()
    assert_error(me.client.get("/api/v1/users/me"), 401, "session_revoked")
    # The username is free again.
    r = api.post(
        "/api/v1/auth/register",
        {"username": "arjun", "display_name": "A", "password": PASSWORD, "device": device_json()},
        format="json",
    )
    assert r.status_code == 201
