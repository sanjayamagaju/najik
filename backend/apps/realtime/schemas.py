"""Strict schemas for client → server WebSocket frames (PROTOCOL.md §4.2).

Unknown fields are rejected and no type coercion happens (``"1"`` is not an int), except
that UUIDs are accepted from their canonical string form.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic import ValidationError as PydanticValidationError

Id = Annotated[uuid.UUID, Field(strict=False)]
Seq = Annotated[int, Field(ge=0, le=2**62)]
MAX_SIGNAL_BYTES = 16 * 1024


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class Empty(Strict):
    pass


class AuthData(Strict):
    token: Annotated[str, Field(min_length=1, max_length=4096)]


class AppStateData(Strict):
    state: Literal["active", "background"]


class MessageSendData(Strict):
    conversation_id: Id
    client_id: Id
    body: Annotated[str, Field(max_length=20000)]


class ReceiptData(Strict):
    conversation_id: Id
    seq: Seq


class TypingData(Strict):
    conversation_id: Id
    state: Literal["start", "stop"]


class PresenceSubscribeData(Strict):
    user_ids: Annotated[list[Id], Field(max_length=200)]


class PingSendData(Strict):
    conversation_id: Id
    client_id: Id


class CallInviteData(Strict):
    call_id: Id
    callee_id: Id
    media: Literal["audio", "video"]


class CallIdData(Strict):
    call_id: Id


class CallHangupData(Strict):
    call_id: Id
    reason: Literal["completed", "cancelled", "failed"] | None = None


# --- call.signal payloads ---------------------------------------------------------------
Sdp = Annotated[str, Field(min_length=1, max_length=MAX_SIGNAL_BYTES)]


class OfferSignal(Strict):
    type: Literal["offer"]
    sdp: Sdp
    iceRestart: bool | None = None


class AnswerSignal(Strict):
    type: Literal["answer"]
    sdp: Sdp


class IceCandidate(Strict):
    candidate: Annotated[str, Field(max_length=2048)]
    sdpMid: Annotated[str, Field(max_length=64)] | None = None
    sdpMLineIndex: Annotated[int, Field(ge=0, le=64)] | None = None
    usernameFragment: Annotated[str, Field(max_length=256)] | None = None


class CandidateSignal(Strict):
    type: Literal["candidate"]
    candidate: IceCandidate


class RenegotiateSignal(Strict):
    type: Literal["renegotiate"]


class QualitySignal(Strict):
    type: Literal["quality"]
    video: Literal["auto", "144p", "240p", "360p", "480p", "720p", "1080p"]
    audio: Literal["auto", "low", "medium", "high"]


Signal = Annotated[
    OfferSignal | AnswerSignal | CandidateSignal | RenegotiateSignal | QualitySignal,
    Field(discriminator="type"),
]


class CallSignalData(Strict):
    call_id: Id
    signal: Signal


class CallMediaStateData(Strict):
    call_id: Id
    audio_muted: bool
    video_enabled: bool


def error_details(exc: PydanticValidationError) -> dict[str, Any]:
    details: dict[str, list[str]] = {}
    for err in exc.errors(include_url=False, include_input=False):
        loc = ".".join(str(p) for p in err["loc"]) or "data"
        details.setdefault(loc, []).append(err["msg"])
    return details


__all__ = [
    "AppStateData",
    "AuthData",
    "CallHangupData",
    "CallIdData",
    "CallInviteData",
    "CallMediaStateData",
    "CallSignalData",
    "Empty",
    "MessageSendData",
    "PingSendData",
    "PresenceSubscribeData",
    "PydanticValidationError",
    "ReceiptData",
    "TypingData",
    "error_details",
]
