"""Server-authoritative call state machine (PROTOCOL.md §4.4).

``invite -> ringing -> accept -> active -> hangup/peer lost -> ended``
``ringing -> decline / cancel / timeout (45 s) / busy -> ended``

Every transition takes a row lock on the call in Postgres, so concurrent accepts from two
callee devices, a hangup racing a timeout, etc. resolve deterministically and idempotently.
Side effects (Redis state, channel-layer events, pushes) run after the transaction commits.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.presenters import public_user
from apps.calls import presenters, state, timers
from apps.calls.ice import ice_servers
from apps.calls.models import Call, CallState, EndReason
from apps.chat import services as chat_services
from apps.chat.models import MessageKind
from apps.core import metrics
from apps.core.errors import ApiError, Conflict, NotFound, validation_error
from apps.core.logging import get_logger
from apps.realtime import presence
from apps.realtime.events import Event, emit_sync, session_group, user_group

log = get_logger(__name__)

CALL_LOG_NAMESPACE = uuid.UUID("6f1c7a1e-8a53-4c47-9d2b-3c1f4f0e9a10")

# Outcome recorded in the call-log message for each end reason.
OUTCOME = {
    EndReason.COMPLETED: "completed",
    EndReason.TIMEOUT: "missed",
    EndReason.MISSED: "missed",
    EndReason.DECLINED: "declined",
    EndReason.CANCELLED: "cancelled",
    EndReason.FAILED: "failed",
    EndReason.BUSY: "busy",
}


class CallNotFound(ApiError):
    status_code = 404
    code = "call_not_found"
    default_detail = "Call not found."


class AlreadyInCall(ApiError):
    status_code = 409
    code = "busy"
    default_detail = "You are already in a call."


@dataclass(slots=True)
class CallResult:
    data: dict[str, Any] = field(default_factory=dict)
    timers: list[timers.Timer] = field(default_factory=list)


def _ack(call: Call, user_id: uuid.UUID) -> dict[str, Any]:
    return {"call": presenters.call(call), "ice_servers": ice_servers(user_id)["ice_servers"]}


def _transition_log(call: Call, event: str, **extra: Any) -> None:
    log.info(
        "call_transition",
        transition=event,
        call_id=str(call.id),
        state=call.state,
        caller_id=str(call.caller_id),
        callee_id=str(call.callee_id),
        end_reason=call.end_reason or None,
        **extra,
    )


def _push(kind: str, call_id: uuid.UUID, **kwargs: Any) -> None:
    from apps.push import tasks as push_tasks

    try:
        if kind == "incoming":
            push_tasks.send_call_incoming_push.delay(str(call_id))
        else:
            push_tasks.send_call_ended_push.delay(
                str(call_id), kwargs["reason"], kwargs.get("exclude_session")
            )
    except Exception:
        log.exception("push_enqueue_failed", call_id=str(call_id), kind=kind)


# ----------------------------------------------------------------------------------------
# Invite
# ----------------------------------------------------------------------------------------
def invite(
    caller: User, session_id: uuid.UUID, call_id: uuid.UUID, callee_id: uuid.UUID, media: str
) -> CallResult:
    if callee_id == caller.id:
        raise validation_error("callee_id", "You cannot call yourself.")
    existing = Call.objects.filter(pk=call_id).first()
    if existing is not None:
        if existing.caller_id == caller.id and existing.callee_id == callee_id:
            return CallResult(_ack(existing, caller.id))  # idempotent retry
        raise Conflict("call_id already in use.", details={"call_id": ["call_id_reused"]})
    callee = User.objects.filter(pk=callee_id, is_active=True).first()
    if callee is None:
        raise NotFound("User not found.")
    conversation, _ = chat_services.get_or_create_conversation(caller, callee.id)

    if not state.claim_user(caller.id, call_id):
        raise AlreadyInCall()
    if not state.claim_user(callee.id, call_id):
        state.release_user(caller.id, call_id)
        return _invite_busy(caller, session_id, call_id, callee, media, conversation.id)

    try:
        with transaction.atomic():
            call = Call.objects.create(
                id=call_id,
                conversation_id=conversation.id,
                caller=caller,
                callee=callee,
                media=media,
                state=CallState.RINGING,
                caller_session_id=session_id,
            )
    except IntegrityError as exc:
        state.release_user(caller.id, call_id)
        state.release_user(callee.id, call_id)
        raise Conflict("call_id already in use.", details={"call_id": ["call_id_reused"]}) from exc

    state.put_call(call)
    state.bind_session(session_id, call.id)
    ring = timers.schedule(state.ring_member(call.id), settings.CALL_RING_TIMEOUT_SEC)
    emit_sync(
        [
            Event(
                user_group(callee.id),
                "call.incoming",
                {"call": presenters.call(call), "caller": public_user(caller)},
                attach_ice=True,
            )
        ]
    )
    _push("incoming", call.id)
    metrics.CALLS_STARTED.labels(media).inc()
    _transition_log(call, "invite", session_id=str(session_id))
    return CallResult(_ack(call, caller.id), [ring])


def _invite_busy(
    caller: User,
    session_id: uuid.UUID,
    call_id: uuid.UUID,
    callee: User,
    media: str,
    conversation_id: uuid.UUID,
) -> CallResult:
    now = timezone.now()
    with transaction.atomic():
        call = Call.objects.create(
            id=call_id,
            conversation_id=conversation_id,
            caller=caller,
            callee=callee,
            media=media,
            state=CallState.ENDED,
            end_reason=EndReason.BUSY,
            caller_session_id=session_id,
            ended_at=now,
        )
        msg = _append_call_log(call)
    events = [
        Event(
            session_group(session_id),
            "call.ended",
            {"call_id": str(call.id), "reason": EndReason.BUSY},
        )
    ]
    if msg is not None:
        events += chat_services.message_events(msg, callee.id)
    emit_sync(events)
    metrics.CALLS_ENDED.labels(EndReason.BUSY).inc()
    _transition_log(call, "busy")
    return CallResult(_ack(call, caller.id))


def _append_call_log(call: Call) -> Any:
    return chat_services.append_system_message(
        call.conversation_id,
        sender_id=call.caller_id,
        client_id=uuid.uuid5(CALL_LOG_NAMESPACE, f"call:{call.id}"),
        kind=MessageKind.CALL,
        meta={
            "call_id": str(call.id),
            "media": call.media,
            "outcome": OUTCOME.get(EndReason(call.end_reason), "failed"),
            "duration_sec": call.duration_sec,
        },
    )


# ----------------------------------------------------------------------------------------
# Callee actions
# ----------------------------------------------------------------------------------------
def ringing(user: User, session_id: uuid.UUID, call_id: uuid.UUID) -> CallResult:
    live = state.get_call(call_id)
    if live.get("callee_id") != str(user.id) or live.get("state") != CallState.RINGING:
        raise CallNotFound()
    if live.get("caller_sid"):
        emit_sync(
            [Event(session_group(live["caller_sid"]), "call.ringing", {"call_id": str(call_id)})]
        )
    return CallResult()


def accept(user: User, session_id: uuid.UUID, call_id: uuid.UUID) -> CallResult:
    with transaction.atomic():
        call = Call.objects.select_for_update().filter(pk=call_id).first()
        if call is None or call.callee_id != user.id:
            raise CallNotFound()
        if call.state == CallState.ACTIVE and call.callee_session_id == session_id:
            return CallResult(_ack(call, user.id))  # idempotent retry
        if call.state != CallState.RINGING:
            raise CallNotFound("This call is no longer ringing.")
        call.state = CallState.ACTIVE
        call.answered_at = timezone.now()
        call.callee_session_id = session_id
        call.save(update_fields=["state", "answered_at", "callee_session"])

    state.cancel(state.ring_member(call.id))
    state.put_call(call)
    state.bind_session(session_id, call.id)
    accepted = {"call_id": str(call.id), "session_id": str(session_id)}
    events = [
        Event(user_group(user.id), "call.accepted", accepted),
        Event(
            user_group(user.id),
            "call.ended",
            {"call_id": str(call.id), "reason": EndReason.ANSWERED_ELSEWHERE},
            exclude_session=str(session_id),
        ),
    ]
    if call.caller_session_id:
        events.insert(0, Event(session_group(call.caller_session_id), "call.accepted", accepted))
    emit_sync(events)
    _push("ended", call.id, reason=EndReason.ANSWERED_ELSEWHERE, exclude_session=str(session_id))
    _transition_log(call, "accept", session_id=str(session_id))
    return CallResult(_ack(call, user.id))


def decline(user: User, session_id: uuid.UUID, call_id: uuid.UUID) -> CallResult:
    call = Call.objects.filter(pk=call_id, callee_id=user.id).first()
    if call is None:
        raise CallNotFound()
    if call.state == CallState.ACTIVE and call.callee_session_id == session_id:
        return hangup(user, session_id, call_id, None)
    if not finish(call_id, EndReason.DECLINED, allowed_states=(CallState.RINGING,)):
        raise CallNotFound()
    return CallResult()


def hangup(user: User, session_id: uuid.UUID, call_id: uuid.UUID, reason: str | None) -> CallResult:
    call = Call.objects.filter(pk=call_id).first()
    if call is None or user.id not in (call.caller_id, call.callee_id):
        raise CallNotFound()
    if call.state == CallState.RINGING:
        if user.id == call.caller_id:
            end = EndReason.FAILED if reason == "failed" else EndReason.CANCELLED
        else:
            end = EndReason.DECLINED
        done = finish(call_id, end, allowed_states=(CallState.RINGING,))
    elif call.state == CallState.ACTIVE:
        if user.id == call.callee_id and call.callee_session_id != session_id:
            raise CallNotFound()
        end = EndReason.FAILED if reason == "failed" else EndReason.COMPLETED
        done = finish(call_id, end, allowed_states=(CallState.ACTIVE,))
    else:
        done = False
    if not done:
        raise CallNotFound()
    return CallResult()


# ----------------------------------------------------------------------------------------
# Ending
# ----------------------------------------------------------------------------------------
def finish(
    call_id: uuid.UUID | str,
    reason: str,
    *,
    allowed_states: tuple[str, ...] = (CallState.RINGING, CallState.ACTIVE),
) -> bool:
    """End a call if it is in ``allowed_states``. Idempotent; returns whether it ended now."""
    with transaction.atomic():
        call = Call.objects.select_for_update().filter(pk=call_id).first()
        if call is None or call.state not in allowed_states:
            return False
        was_ringing = call.state == CallState.RINGING
        call.state = CallState.ENDED
        call.end_reason = reason
        call.ended_at = timezone.now()
        call.save(update_fields=["state", "end_reason", "ended_at"])
        msg = _append_call_log(call)

    state.clear_call(call)
    payload = {"call_id": str(call.id), "reason": reason}
    events = [
        Event(user_group(call.caller_id), "call.ended", payload),
        Event(user_group(call.callee_id), "call.ended", payload),
    ]
    if msg is not None:
        events += chat_services.message_events(msg, call.callee_id)
    emit_sync(events)
    if was_ringing:
        _push("ended", call.id, reason=reason)
    metrics.CALLS_ENDED.labels(reason).inc()
    _transition_log(call, "end", duration_sec=call.duration_sec)
    return True


def end_calls_for_user(user_id: uuid.UUID, *, reason: str) -> int:
    live = Call.objects.filter(state__in=[CallState.RINGING, CallState.ACTIVE]).filter(
        caller_id=user_id
    ) | Call.objects.filter(state__in=[CallState.RINGING, CallState.ACTIVE], callee_id=user_id)
    return sum(1 for call_id in live.values_list("id", flat=True) if finish(call_id, reason))


# ----------------------------------------------------------------------------------------
# Connectivity (reconnect grace) and deadlines
# ----------------------------------------------------------------------------------------
def _grace_applies(live: dict[str, str], session_id: str) -> bool:
    if live.get("state") == CallState.ACTIVE:
        return session_id in (live.get("caller_sid"), live.get("callee_sid"))
    if live.get("state") == CallState.RINGING:
        return session_id == live.get("caller_sid")
    return False


def on_session_disconnected(session_id: uuid.UUID | str) -> list[timers.Timer]:
    """Start the 30 s grace timer when a call participant's session lost its last socket."""
    sid = str(session_id)
    call_id = state.session_call(sid)
    if not call_id or presence.session_live_connections(sid) > 0:
        return []
    live = state.get_call(call_id)
    if not _grace_applies(live, sid):
        return []
    log.info("call_participant_lost", call_id=call_id, session_id=sid)
    return [timers.schedule(state.grace_member(call_id, sid), settings.CALL_RECONNECT_GRACE_SEC)]


def on_session_connected(session_id: uuid.UUID | str) -> None:
    """Cancel a pending grace timer when the session reconnects."""
    sid = str(session_id)
    call_id = state.session_call(sid)
    if call_id and state.cancel(state.grace_member(call_id, sid)):
        log.info("call_participant_reconnected", call_id=call_id, session_id=sid)


def enforce_deadline(member: str, *, now_ms: int | None = None) -> bool:
    """Apply a due deadline. Safe to call any number of times from any node."""
    due = state.deadline(member)
    if due is None:
        return False
    now = now_ms if now_ms is not None else state._now_ms()
    if due > now:
        return False
    parts = member.split("|")
    processed = False
    if parts[0] == "ring" and len(parts) == 2:
        processed = finish(parts[1], EndReason.TIMEOUT, allowed_states=(CallState.RINGING,))
    elif (
        parts[0] == "grace" and len(parts) == 3 and presence.session_live_connections(parts[2]) == 0
    ):
        processed = finish(parts[1], EndReason.FAILED)
    state.cancel(member)
    return processed


def sweep(*, now_ms: int | None = None) -> int:
    """Backstop run by Celery beat: enforce due deadlines and repair lost state."""
    now = now_ms if now_ms is not None else state._now_ms()
    handled = 0
    for member in state.due_members(now):
        handled += int(enforce_deadline(member, now_ms=now))

    # Ringing calls whose deadline vanished (e.g. Redis restart) or that were never enforced.
    cutoff = timezone.now() - timedelta(seconds=settings.CALL_RING_TIMEOUT_SEC + 15)
    for call_id in Call.objects.filter(state=CallState.RINGING, created_at__lt=cutoff).values_list(
        "id", flat=True
    ):
        handled += int(finish(call_id, EndReason.TIMEOUT, allowed_states=(CallState.RINGING,)))

    # Participants whose node died without a disconnect: start their grace timers.
    live_calls = Call.objects.filter(state__in=[CallState.RINGING, CallState.ACTIVE]).values_list(
        "id", "state", "caller_session_id", "callee_session_id"
    )
    for call_id, call_state, caller_sid, callee_sid in live_calls:
        sids = [caller_sid] if call_state == CallState.RINGING else [caller_sid, callee_sid]
        for sid in sids:
            if sid is None:
                handled += int(finish(call_id, EndReason.FAILED))
                break
            if presence.session_live_connections(sid) == 0:
                state.schedule(
                    state.grace_member(call_id, sid),
                    settings.CALL_RECONNECT_GRACE_SEC,
                    only_if_absent=True,
                )
    return handled


# ----------------------------------------------------------------------------------------
# Queries
# ----------------------------------------------------------------------------------------
def call_for_participant(user_id: uuid.UUID, call_id: uuid.UUID) -> Call:
    call = Call.objects.filter(pk=call_id).first()
    if call is None or user_id not in (call.caller_id, call.callee_id):
        raise NotFound("Call not found.")
    return call
