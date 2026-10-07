"""The single WebSocket endpoint ``/ws/v1/`` (PROTOCOL.md §4).

Lifecycle: accept → first-frame ``auth`` within ``WS_AUTH_TIMEOUT_SEC`` → join groups
(``u.<user>``, ``s.<session>``) → register the connection in Redis presence → dispatch frames.
Every client frame with an ``id`` gets exactly one ``ack``.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections import deque
from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.conf import settings
from rest_framework.exceptions import ValidationError as DRFValidationError

from apps.accounts.models import User
from apps.accounts.revocation import ais_revoked
from apps.accounts.tokens import TokenError, decode_access_token
from apps.calls import services as call_services
from apps.calls import state as call_state
from apps.calls import timers as call_timers
from apps.calls.ice import ice_servers
from apps.calls.models import CallState
from apps.chat import presenters as chat_presenters
from apps.chat import services as chat_services
from apps.chat.models import MessageKind
from apps.core import metrics, ratelimit
from apps.core.errors import ApiError
from apps.core.logging import get_logger
from apps.core.utils import clean_text, iso, utcnow
from apps.realtime import presence, schemas
from apps.realtime import services as rt_services
from apps.realtime.events import (
    Event,
    emit,
    presence_group,
    session_group,
    user_group,
)

log = get_logger("najik.ws")

# Close codes (PROTOCOL.md §4.1)
CLOSE_AUTH_TIMEOUT = 4001
CLOSE_TOKEN_EXPIRED = 4003
CLOSE_TOKEN_INVALID = 4004
CLOSE_RATE_LIMITED = 4008
CLOSE_MALFORMED = 4009
CLOSE_GOING_AWAY = 1001

ENVELOPE_KEYS = frozenset({"type", "id", "data"})


class WsError(Exception):
    def __init__(self, code: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.extra = extra


def _dumps(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


class RealtimeConsumer(AsyncWebsocketConsumer):
    # ------------------------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------------------------
    async def connect(self) -> None:
        self.conn_id: str = self.channel_name
        self.user: User | None = None
        self.user_id: uuid.UUID | None = None
        self.session_id: uuid.UUID | None = None
        self.authenticated = False
        self.closing = False
        self.app_active = True
        self.connected_at = time.monotonic()
        self.last_frame_at = self.connected_at
        self.last_presence_refresh = 0.0
        self.joined: set[str] = set()
        self.presence_subscriptions: set[uuid.UUID] = set()
        self.peer_cache: dict[uuid.UUID, uuid.UUID] = {}
        self.limited_at: deque[float] = deque()
        self.close_code_sent: int | None = None
        await self.accept()
        self.watchdog = asyncio.create_task(self._watchdog())

    async def disconnect(self, code: int) -> None:
        watchdog = getattr(self, "watchdog", None)
        if watchdog is not None:
            watchdog.cancel()
        effective = self.close_code_sent or code
        metrics.WS_CLOSES.labels(str(effective)).inc()
        if not getattr(self, "authenticated", False):
            return
        self.authenticated = False
        metrics.WS_CONNECTIONS.dec()
        for group in list(self.joined):
            await self.channel_layer.group_discard(group, self.channel_name)
        self.joined.clear()
        try:
            update = await presence.aupdate(self.user_id, self.session_id, self.conn_id, "remove")
            if update.transition:
                await database_sync_to_async(rt_services.publish_presence)(
                    self.user_id, update.transition
                )
            if update.session_connections == 0:
                timers = await database_sync_to_async(call_services.on_session_disconnected)(
                    self.session_id
                )
                call_timers.start_local(timers)
        except Exception:
            log.exception("ws_disconnect_cleanup_failed")
        log.info(
            "ws_disconnected",
            code=effective,
            duration_sec=round(time.monotonic() - self.connected_at, 1),
        )

    async def _close(self, code: int) -> None:
        if self.closing:
            return
        self.closing = True
        self.close_code_sent = code
        await self.close(code=code)

    async def _watchdog(self) -> None:
        idle_limit = 2 * settings.WS_HEARTBEAT_SEC
        tick = min(1.0, settings.WS_AUTH_TIMEOUT_SEC / 4)
        try:
            while not self.closing:
                await asyncio.sleep(tick)
                now = time.monotonic()
                if not self.authenticated:
                    if now - self.connected_at >= settings.WS_AUTH_TIMEOUT_SEC:
                        log.info("ws_auth_timeout")
                        await self._close(CLOSE_AUTH_TIMEOUT)
                        return
                elif now - self.last_frame_at >= idle_limit:
                    log.info("ws_idle_timeout", user_id=str(self.user_id))
                    await self._close(CLOSE_GOING_AWAY)
                    return
        except asyncio.CancelledError:
            pass

    # ------------------------------------------------------------------------------------
    # Inbound frames
    # ------------------------------------------------------------------------------------
    async def receive(self, text_data: str | None = None, bytes_data: bytes | None = None) -> None:
        if self.closing:
            return
        if text_data is None:
            await self._close(CLOSE_MALFORMED)
            return
        if len(text_data) * 4 > settings.WS_MAX_FRAME_BYTES and (
            len(text_data.encode("utf-8")) > settings.WS_MAX_FRAME_BYTES
        ):
            log.info("ws_frame_too_large", size=len(text_data))
            await self._close(CLOSE_MALFORMED)
            return
        try:
            frame = json.loads(text_data)
        except ValueError:
            await self._close(CLOSE_MALFORMED)
            return
        envelope = self._envelope(frame)
        if envelope is None:
            await self._close(CLOSE_MALFORMED)
            return
        frame_type, frame_id, data = envelope
        self.last_frame_at = time.monotonic()

        if not self.authenticated:
            if frame_type != "auth":
                await self._close(CLOSE_AUTH_TIMEOUT)
                return
            await self._authenticate(frame_id, data)
            return

        if frame_type == "hb":
            await self._refresh_presence()
            reply: dict[str, Any] = {"type": "hb"}
            if frame_id is not None:
                reply["id"] = frame_id
            await self.send(text_data=_dumps(reply))
            return

        await self._dispatch(frame_type, frame_id, data)

    @staticmethod
    def _envelope(frame: Any) -> tuple[str, str | int | None, dict[str, Any]] | None:
        if not isinstance(frame, dict) or set(frame) - ENVELOPE_KEYS:
            return None
        frame_type = frame.get("type")
        frame_id = frame.get("id")
        data = frame.get("data", {})
        if not isinstance(frame_type, str) or not 1 <= len(frame_type) <= 64:
            return None
        if frame_id is not None and not (
            (isinstance(frame_id, str) and len(frame_id) <= 64)
            or (isinstance(frame_id, int) and not isinstance(frame_id, bool))
        ):
            return None
        if data is None:
            data = {}
        if not isinstance(data, dict):
            return None
        return frame_type, frame_id, data

    async def _ack_ok(self, frame_id: str | int | None, data: dict[str, Any] | None) -> None:
        if frame_id is None:
            return
        await self.send(
            text_data=_dumps({"type": "ack", "id": frame_id, "ok": True, "data": data or {}})
        )

    async def _ack_error(
        self, frame_id: str | int | None, code: str, message: str, **extra: Any
    ) -> None:
        if frame_id is None:
            return
        error = {"code": code, "message": message, **extra}
        await self.send(
            text_data=_dumps({"type": "ack", "id": frame_id, "ok": False, "error": error})
        )

    async def _dispatch(self, frame_type: str, frame_id: str | int | None, data: dict) -> None:
        handler = self.HANDLERS.get(frame_type)
        if handler is None:
            metrics.WS_FRAMES.labels("unknown", "error").inc()
            await self._ack_error(frame_id, "unknown_type", "Unknown frame type.")
            return
        result_label = "ok"
        try:
            if frame_type not in self.UNMETERED:
                await self._limit(("ws_other", self.conn_id))
            result = await handler(self, data)
            await self._ack_ok(frame_id, result)
        except WsError as exc:
            result_label = exc.code
            await self._ack_error(frame_id, exc.code, exc.message, **exc.extra)
            if exc.code == "rate_limited":
                await self._note_rate_limited()
        except schemas.PydanticValidationError as exc:
            result_label = "validation_error"
            await self._ack_error(
                frame_id, "validation_error", "Invalid data.", details=schemas.error_details(exc)
            )
        except DRFValidationError as exc:
            result_label = "validation_error"
            details = exc.detail if isinstance(exc.detail, dict) else {"data": exc.detail}
            await self._ack_error(
                frame_id,
                "validation_error",
                "Invalid data.",
                details={
                    k: [str(m) for m in (v if isinstance(v, list) else [v])]
                    for k, v in details.items()
                },
            )
        except ApiError as exc:
            result_label = exc.code
            await self._ack_error(frame_id, exc.code, exc.message)
        except Exception:
            result_label = "server_error"
            log.exception("ws_handler_failed", frame_type=frame_type)
            await self._ack_error(frame_id, "server_error", "Something went wrong.")
        metrics.WS_FRAMES.labels(frame_type, result_label).inc()

    async def _limit(self, *checks: tuple[str, str]) -> None:
        decision = await ratelimit.ahit(*checks)
        if not decision.allowed:
            metrics.RATE_LIMITED.labels(checks[0][0]).inc()
            raise WsError(
                "rate_limited", "Too many requests.", retry_after_sec=decision.retry_after_sec
            )

    async def _note_rate_limited(self) -> None:
        now = time.monotonic()
        self.limited_at.append(now)
        while self.limited_at and now - self.limited_at[0] > 60:
            self.limited_at.popleft()
        if len(self.limited_at) >= settings.WS_ABUSE_CLOSE_THRESHOLD:
            log.warning("ws_rate_limit_abuse", user_id=str(self.user_id))
            await self._close(CLOSE_RATE_LIMITED)

    # ------------------------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------------------------
    async def _authenticate(self, frame_id: str | int | None, data: dict) -> None:
        try:
            token = schemas.AuthData.model_validate(data).token
        except schemas.PydanticValidationError:
            await self._ack_error(frame_id, "not_authenticated", "Missing token.")
            await self._close(CLOSE_AUTH_TIMEOUT)
            return
        try:
            claims = decode_access_token(token)
        except TokenError as exc:
            await self._ack_error(frame_id, exc.code, exc.message)
            await self._close(
                CLOSE_TOKEN_EXPIRED if exc.code == "token_expired" else CLOSE_TOKEN_INVALID
            )
            return
        loaded = None
        if not await ais_revoked(claims.session_id):
            loaded = await database_sync_to_async(rt_services.load_session)(
                claims.user_id, claims.session_id
            )
        if loaded is None:
            await self._ack_error(frame_id, "session_revoked", "This session has been revoked.")
            await self._close(CLOSE_TOKEN_INVALID)
            return
        if self.closing:
            return
        user, session = loaded
        self.user, self.user_id, self.session_id = user, user.id, session.id
        structlog.contextvars.bind_contextvars(
            user_id=str(user.id), session_id=str(session.id), conn_id=self.conn_id[-12:]
        )
        for group in (user_group(user.id), session_group(session.id)):
            await self.channel_layer.group_add(group, self.channel_name)
            self.joined.add(group)
        self.authenticated = True
        metrics.WS_CONNECTIONS.inc()
        update = await presence.aupdate(user.id, session.id, self.conn_id, "active")
        self.last_presence_refresh = time.monotonic()
        await self._ack_ok(
            frame_id,
            {
                "user_id": str(user.id),
                "session_id": str(session.id),
                "server_time": iso(utcnow()),
                "heartbeat_sec": settings.WS_HEARTBEAT_SEC,
            },
        )
        if update.transition:
            await database_sync_to_async(rt_services.publish_presence)(user.id, update.transition)
        await database_sync_to_async(call_services.on_session_connected)(session.id)
        log.info("ws_connected", platform=session.platform)

    async def _reauth(self, data: dict) -> dict[str, Any]:
        """A second ``auth`` frame (e.g. after a token refresh) on an open socket."""
        token = schemas.AuthData.model_validate(data).token
        try:
            claims = decode_access_token(token)
        except TokenError as exc:
            raise WsError(exc.code, exc.message) from exc
        if claims.session_id != self.session_id or claims.user_id != self.user_id:
            raise WsError("forbidden", "Token belongs to a different session.")
        return {
            "user_id": str(self.user_id),
            "session_id": str(self.session_id),
            "server_time": iso(utcnow()),
            "heartbeat_sec": settings.WS_HEARTBEAT_SEC,
        }

    async def _refresh_presence(self) -> None:
        now = time.monotonic()
        if now - self.last_presence_refresh < settings.WS_HEARTBEAT_SEC / 2:
            return
        self.last_presence_refresh = now
        mode = "active" if self.app_active else "background"
        update = await presence.aupdate(self.user_id, self.session_id, self.conn_id, mode)
        if update.transition:
            await database_sync_to_async(rt_services.publish_presence)(
                self.user_id, update.transition
            )

    # ------------------------------------------------------------------------------------
    # Handlers
    # ------------------------------------------------------------------------------------
    async def _app_state(self, data: dict) -> None:
        d = schemas.AppStateData.model_validate(data)
        self.app_active = d.state == "active"
        self.last_presence_refresh = time.monotonic()
        update = await presence.aupdate(self.user_id, self.session_id, self.conn_id, d.state)
        if update.transition:
            await database_sync_to_async(rt_services.publish_presence)(
                self.user_id, update.transition
            )

    async def _peer_of(self, conversation_id: uuid.UUID) -> uuid.UUID:
        """Membership check (cached per connection; 1-to-1 membership never changes)."""
        peer = self.peer_cache.get(conversation_id)
        if peer is None:
            member = await database_sync_to_async(chat_services.get_membership)(
                self.user_id, conversation_id
            )
            peer = member.peer_id
            self.peer_cache[conversation_id] = peer
        return peer

    def _send_and_publish(
        self, conversation_id: uuid.UUID, client_id: uuid.UUID, kind: str, body: str
    ) -> dict[str, Any]:
        result = chat_services.send_message(
            self.user, conversation_id, client_id, kind=kind, body=body
        )
        chat_services.publish_new_message(result, self.user)
        return {"message": chat_presenters.message(result.message)}

    async def _message_send(self, data: dict) -> dict[str, Any]:
        d = schemas.MessageSendData.model_validate(data)
        body = clean_text(d.body)
        if not 1 <= len(body) <= chat_services.MAX_BODY_CHARS:
            raise WsError(
                "validation_error",
                f"Message must be 1-{chat_services.MAX_BODY_CHARS} characters.",
                details={"body": ["Invalid length."]},
            )
        uid = str(self.user_id)
        await self._limit(("message_burst", uid), ("message_hour", uid))
        return await database_sync_to_async(self._send_and_publish)(
            d.conversation_id, d.client_id, MessageKind.TEXT, body
        )

    async def _receipt(self, data: dict, *, read: bool) -> None:
        d = schemas.ReceiptData.model_validate(data)
        await database_sync_to_async(chat_services.mark)(
            self.user_id,
            d.conversation_id,
            delivered_seq=None if read else d.seq,
            read_seq=d.seq if read else None,
        )

    async def _message_delivered(self, data: dict) -> None:
        await self._receipt(data, read=False)

    async def _message_read(self, data: dict) -> None:
        await self._receipt(data, read=True)

    async def _typing(self, data: dict) -> None:
        d = schemas.TypingData.model_validate(data)
        await self._limit(("typing", str(self.user_id)))
        peer = await self._peer_of(d.conversation_id)
        await emit(
            [
                Event(
                    user_group(peer),
                    "typing",
                    {
                        "conversation_id": str(d.conversation_id),
                        "user_id": str(self.user_id),
                        "state": d.state,
                    },
                )
            ]
        )

    async def _presence_subscribe(self, data: dict) -> dict[str, Any]:
        d = schemas.PresenceSubscribeData.model_validate(data)
        await self._limit(("presence_subscribe", str(self.user_id)))
        requested = list(dict.fromkeys(d.user_ids))
        allowed = await database_sync_to_async(chat_services.shared_peer_ids)(
            self.user_id, requested
        )
        for user_id in self.presence_subscriptions - allowed:
            group = presence_group(user_id)
            await self.channel_layer.group_discard(group, self.channel_name)
            self.joined.discard(group)
        for user_id in allowed - self.presence_subscriptions:
            group = presence_group(user_id)
            await self.channel_layer.group_add(group, self.channel_name)
            self.joined.add(group)
        self.presence_subscriptions = set(allowed)
        ordered = [u for u in requested if u in allowed]
        result = await database_sync_to_async(presence.presence_for)(ordered)
        return {"presence": result}

    async def _ping_send(self, data: dict) -> dict[str, Any]:
        d = schemas.PingSendData.model_validate(data)
        await self._peer_of(d.conversation_id)
        await self._limit(
            ("ping_pair", f"{self.user_id}|{d.conversation_id}"),
            ("ping_hour", str(self.user_id)),
        )
        return await database_sync_to_async(self._send_and_publish)(
            d.conversation_id, d.client_id, MessageKind.PING, ""
        )

    # --- calls --------------------------------------------------------------------------
    async def _call_invite(self, data: dict) -> dict[str, Any]:
        d = schemas.CallInviteData.model_validate(data)
        await self._limit(("call_invite", str(self.user_id)))
        result = await database_sync_to_async(call_services.invite)(
            self.user, self.session_id, d.call_id, d.callee_id, d.media
        )
        call_timers.start_local(result.timers)
        return result.data

    async def _call_ringing(self, data: dict) -> None:
        d = schemas.CallIdData.model_validate(data)
        await database_sync_to_async(call_services.ringing)(self.user, self.session_id, d.call_id)

    async def _call_accept(self, data: dict) -> dict[str, Any]:
        d = schemas.CallIdData.model_validate(data)
        result = await database_sync_to_async(call_services.accept)(
            self.user, self.session_id, d.call_id
        )
        return result.data

    async def _call_decline(self, data: dict) -> None:
        d = schemas.CallIdData.model_validate(data)
        await database_sync_to_async(call_services.decline)(self.user, self.session_id, d.call_id)

    async def _call_hangup(self, data: dict) -> None:
        d = schemas.CallHangupData.model_validate(data)
        await database_sync_to_async(call_services.hangup)(
            self.user, self.session_id, d.call_id, d.reason
        )

    async def _bound_peer_session(self, call_id: uuid.UUID) -> str:
        """The other bound session of an active call this session participates in."""
        live = await call_state.aget_call(call_id)
        me, sid = str(self.user_id), str(self.session_id)
        if live.get("state") != CallState.ACTIVE:
            raise WsError("call_not_found", "Call not found.")
        if live.get("caller_id") == me and live.get("caller_sid") == sid:
            target = live.get("callee_sid")
        elif live.get("callee_id") == me and live.get("callee_sid") == sid:
            target = live.get("caller_sid")
        else:
            raise WsError("call_not_found", "Call not found.")
        if not target:
            raise WsError("call_not_found", "Call not found.")
        return target

    async def _call_signal(self, data: dict) -> None:
        d = schemas.CallSignalData.model_validate(data)
        signal = data["signal"]
        if len(_dumps(signal).encode("utf-8")) > schemas.MAX_SIGNAL_BYTES:
            raise WsError(
                "validation_error", "Signal too large.", details={"signal": ["Too large."]}
            )
        await self._limit(("call_signal", f"{d.call_id}|{self.user_id}"))
        target = await self._bound_peer_session(d.call_id)
        await emit(
            [
                Event(
                    session_group(target),
                    "call.signal",
                    {"call_id": str(d.call_id), "signal": signal},
                )
            ]
        )

    async def _call_media_state(self, data: dict) -> None:
        d = schemas.CallMediaStateData.model_validate(data)
        await self._limit(("call_signal", f"{d.call_id}|{self.user_id}"))
        target = await self._bound_peer_session(d.call_id)
        await emit(
            [
                Event(
                    session_group(target),
                    "call.media_state",
                    {
                        "call_id": str(d.call_id),
                        "user_id": str(self.user_id),
                        "audio_muted": d.audio_muted,
                        "video_enabled": d.video_enabled,
                    },
                )
            ]
        )

    async def _auth_again(self, data: dict) -> dict[str, Any]:
        return await self._reauth(data)

    HANDLERS: dict[str, Callable[[Any, dict], Awaitable[dict[str, Any] | None]]] = {
        "auth": _auth_again,
        "app.state": _app_state,
        "message.send": _message_send,
        "message.delivered": _message_delivered,
        "message.read": _message_read,
        "typing": _typing,
        "presence.subscribe": _presence_subscribe,
        "ping.send": _ping_send,
        "call.invite": _call_invite,
        "call.ringing": _call_ringing,
        "call.accept": _call_accept,
        "call.decline": _call_decline,
        "call.hangup": _call_hangup,
        "call.signal": _call_signal,
        "call.media_state": _call_media_state,
    }
    # Frames with their own (stricter) limits, or that must never be refused.
    UNMETERED = frozenset(
        {"call.signal", "call.media_state", "call.accept", "call.hangup", "call.decline"}
    )

    # ------------------------------------------------------------------------------------
    # Outbound (channel layer → socket)
    # ------------------------------------------------------------------------------------
    async def rt_event(self, event: dict[str, Any]) -> None:
        if not self.authenticated or self.closing:
            return
        sid = str(self.session_id)
        if event.get("exclude_session") == sid:
            return
        if event.get("only_session") and event["only_session"] != sid:
            return
        frame = event["frame"]
        if event.get("attach_ice"):
            frame = {
                **frame,
                "data": {**frame["data"], "ice_servers": ice_servers(self.user_id)["ice_servers"]},
            }
        await self.send(text_data=_dumps(frame))
        if event.get("close_code"):
            log.info("ws_closed_by_server", code=event["close_code"], frame_type=frame["type"])
            await self._close(int(event["close_code"]))


__all__ = ["RealtimeConsumer"]
