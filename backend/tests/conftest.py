from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from channels.db import database_sync_to_async
from channels.layers import channel_layers
from channels.testing import WebsocketCommunicator
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.services import DeviceInfo, create_session
from apps.calls.timers import cancel_local_timers
from apps.core.redis import reset_clients_for_tests
from apps.push.providers import reset_providers

PASSWORD = "Tr0ub4dor&3-horse"


def pytest_collection_modifyitems(config: Any, items: list[Any]) -> None:
    is_pg = os.environ.get("DATABASE_URL", "").startswith(("postgres://", "postgresql://"))
    skip = pytest.mark.skip(reason="requires PostgreSQL (set DATABASE_URL=postgres://...)")
    for item in items:
        if "postgres" in item.keywords and not is_pg:
            item.add_marker(skip)


@pytest.fixture(autouse=True)
def _isolated_state() -> Iterator[None]:
    reset_clients_for_tests()
    channel_layers.backends.clear()
    reset_providers()
    yield
    cancel_local_timers()
    reset_clients_for_tests()


# ----------------------------------------------------------------------------------------
# Users / sessions
# ----------------------------------------------------------------------------------------
def make_user(username: str, *, display_name: str | None = None, **extra: Any) -> User:
    return User.objects.create_user(
        username, PASSWORD, display_name=display_name or username.title(), **extra
    )


def device(platform: str = "android", device_id: uuid.UUID | None = None) -> DeviceInfo:
    return DeviceInfo(
        device_id=device_id or uuid.uuid4(), platform=platform, name="Pixel 8", app_version="1.0.0"
    )


def device_json(device_id: uuid.UUID | None = None, platform: str = "android") -> dict[str, str]:
    return {
        "device_id": str(device_id or uuid.uuid4()),
        "platform": platform,
        "name": "Pixel 8",
        "app_version": "1.0.0",
    }


class Login:
    """A logged-in device: user + session + tokens + an authenticated API client."""

    def __init__(self, user: User, platform: str = "android") -> None:
        self.user = user
        self.session, self.tokens = create_session(user, device(platform))
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.tokens['access']}")

    @property
    def access(self) -> str:
        return self.tokens["access"]


@pytest.fixture
def api() -> APIClient:
    return APIClient()


@pytest.fixture
def alice() -> User:
    return make_user("alice", display_name="Alice")


@pytest.fixture
def bob() -> User:
    return make_user("bob", display_name="Bob")


@pytest.fixture
def carol() -> User:
    return make_user("carol", display_name="Carol")


# ----------------------------------------------------------------------------------------
# WebSocket helpers
# ----------------------------------------------------------------------------------------
async def ws_open() -> WebsocketCommunicator:
    from config.asgi import application

    comm = WebsocketCommunicator(application, "/ws/v1/")
    connected, _ = await comm.connect()
    assert connected
    return comm


async def ws_connect(access: str) -> WebsocketCommunicator:
    comm = await ws_open()
    await comm.send_json_to({"type": "auth", "id": "auth", "data": {"token": access}})
    ack = await comm.receive_json_from(timeout=3)
    assert ack["type"] == "ack" and ack["ok"], ack
    return comm


async def recv_type(comm: WebsocketCommunicator, frame_type: str, timeout: float = 3) -> dict:
    """Receive frames until one of ``frame_type`` arrives (others are skipped)."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            raise AssertionError(f"no {frame_type!r} frame within {timeout}s")
        frame = await comm.receive_json_from(timeout=remaining)
        if frame.get("type") == frame_type:
            return frame


async def recv_ack(comm: WebsocketCommunicator, frame_id: str, timeout: float = 3) -> dict:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while True:
        frame = await comm.receive_json_from(timeout=max(0.01, deadline - loop.time()))
        if frame.get("type") == "ack" and frame.get("id") == frame_id:
            return frame


async def request(
    comm: WebsocketCommunicator, frame_type: str, data: dict | None = None, frame_id: str = "r1"
) -> dict:
    await comm.send_json_to({"type": frame_type, "id": frame_id, "data": data or {}})
    return await recv_ack(comm, frame_id)


async def drain(comm: WebsocketCommunicator, timeout: float = 0.2) -> list[dict]:
    frames = []
    while not await comm.receive_nothing(timeout=timeout):
        frames.append(await comm.receive_json_from())
    return frames


async def closed_with(comm: WebsocketCommunicator, timeout: float = 3) -> int:
    """Skip frames until the server closes; return the close code."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while True:
        out = await comm.receive_output(timeout=max(0.01, deadline - loop.time()))
        if out["type"] == "websocket.close":
            return out.get("code", 1000)


adb = database_sync_to_async
