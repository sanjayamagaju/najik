import type { Call, CallEndReason, CallMedia } from '@/types/protocol';

/**
 * Pure client-side call state machine (one call at a time).
 *
 *   idle ─DIAL─► outgoing ─REMOTE_RINGING─► ringing ─REMOTE_ACCEPTED─► connecting
 *   idle ─INCOMING─► incoming ─ACCEPT─► connecting
 *   connecting ─MEDIA_CONNECTED─► connected ⇄ reconnecting (MEDIA_INTERRUPTED / MEDIA_CONNECTED)
 *   any live phase ─SERVER_ENDED / HANGUP / LOCAL_FAILURE─► ended(reason) ─RESET─► idle
 *
 * The server is authoritative (PROTOCOL §4.4): `SERVER_ENDED` always wins, events for another
 * call id are ignored, and every transition out of `ended` except RESET/DIAL/INCOMING is a no-op,
 * which makes duplicate/late events (ended twice, accept after cancel) harmless.
 */

export type CallPhase =
  | 'idle'
  | 'outgoing'
  | 'ringing'
  | 'incoming'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'ended';

export type CallDirection = 'outgoing' | 'incoming';

/** Server reasons plus client-only outcomes. */
export type CallEndKind =
  | CallEndReason
  | 'permission_denied'
  | 'media_error'
  | 'offline'
  | 'in_another_call'
  | 'rate_limited'
  | 'error';

export interface CallPeer {
  id: string;
  display_name: string;
  avatar_color: string;
  username?: string;
}

export interface CallMachineState {
  phase: CallPhase;
  callId: string | null;
  direction: CallDirection | null;
  media: CallMedia;
  peer: CallPeer | null;
  conversationId: string | null;
  /** The server accepted the call (`call.accepted` for the caller, accept ack for the callee). */
  accepted: boolean;
  /** Local accept in flight (callee) — guards double taps. */
  accepting: boolean;
  startedAt: number | null;
  connectedAt: number | null;
  endedAt: number | null;
  endReason: CallEndKind | null;
  /** Number of connected → reconnecting transitions (metrics). */
  reconnects: number;
}

export type CallEvent =
  | {
      type: 'DIAL';
      callId: string;
      peer: CallPeer;
      media: CallMedia;
      conversationId: string | null;
      at: number;
    }
  | { type: 'INVITE_ACKED'; call: Call; at: number }
  | { type: 'INVITE_FAILED'; reason: CallEndKind; at: number }
  | { type: 'REMOTE_RINGING'; callId: string }
  | { type: 'REMOTE_ACCEPTED'; callId: string }
  | {
      type: 'INCOMING';
      callId: string;
      peer: CallPeer;
      media: CallMedia;
      conversationId: string | null;
      at: number;
    }
  | { type: 'ACCEPT'; callId: string }
  | { type: 'ACCEPT_ACKED'; callId: string }
  | { type: 'ACCEPT_FAILED'; callId: string; reason: CallEndKind; at: number }
  | { type: 'MEDIA_CONNECTED'; at: number }
  | { type: 'MEDIA_INTERRUPTED' }
  | { type: 'SERVER_ENDED'; callId: string; reason: CallEndReason; at: number }
  | { type: 'HANGUP'; at: number }
  | { type: 'LOCAL_FAILURE'; reason: CallEndKind; at: number }
  | { type: 'RESET' };

export const initialCallState: CallMachineState = {
  phase: 'idle',
  callId: null,
  direction: null,
  media: 'audio',
  peer: null,
  conversationId: null,
  accepted: false,
  accepting: false,
  startedAt: null,
  connectedAt: null,
  endedAt: null,
  endReason: null,
  reconnects: 0,
};

const LIVE: ReadonlySet<CallPhase> = new Set([
  'outgoing',
  'ringing',
  'incoming',
  'connecting',
  'connected',
  'reconnecting',
]);

export function isLive(phase: CallPhase): boolean {
  return LIVE.has(phase);
}

/** Phases in which a second incoming call must be auto-declined as busy. */
export function isBusy(state: CallMachineState): boolean {
  return isLive(state.phase);
}

function end(state: CallMachineState, reason: CallEndKind, at: number): CallMachineState {
  return {
    ...state,
    phase: 'ended',
    endReason: reason,
    endedAt: at,
    accepting: false,
  };
}

/** What a local hang-up means for the server (`call.hangup.reason` / `call.decline`). */
export function localHangupOutcome(
  state: CallMachineState,
): { action: 'decline' } | { action: 'hangup'; reason: 'cancelled' | 'completed' } | null {
  switch (state.phase) {
    case 'incoming':
      return { action: 'decline' };
    case 'outgoing':
    case 'ringing':
      return { action: 'hangup', reason: 'cancelled' };
    case 'connecting':
      // The caller may hang up after `call.accepted` but before media flows.
      return { action: 'hangup', reason: state.accepted ? 'completed' : 'cancelled' };
    case 'connected':
    case 'reconnecting':
      return { action: 'hangup', reason: 'completed' };
    default:
      return null;
  }
}

/** Client-side end reason for a local hang-up in the current phase. */
function hangupReason(state: CallMachineState): CallEndKind {
  switch (state.phase) {
    case 'incoming':
      return 'declined';
    case 'outgoing':
    case 'ringing':
      return 'cancelled';
    case 'connecting':
      return state.accepted ? 'completed' : 'cancelled';
    default:
      return 'completed';
  }
}

function sameCall(state: CallMachineState, callId: string): boolean {
  return state.callId !== null && state.callId === callId;
}

export function transition(state: CallMachineState, event: CallEvent): CallMachineState {
  switch (event.type) {
    case 'DIAL':
      if (isLive(state.phase)) return state; // one call at a time
      return {
        ...initialCallState,
        phase: 'outgoing',
        callId: event.callId,
        direction: 'outgoing',
        media: event.media,
        peer: event.peer,
        conversationId: event.conversationId,
        startedAt: event.at,
      };

    case 'INVITE_ACKED':
      if (!sameCall(state, event.call.id) || state.phase !== 'outgoing') return state;
      // Callee busy: the ack carries an already-ended call (a `call.ended{busy}` follows).
      if (event.call.state === 'ended') {
        return end(state, event.call.end_reason ?? 'busy', event.at);
      }
      return state;

    case 'INVITE_FAILED':
      if (state.phase !== 'outgoing') return state;
      return end(state, event.reason, event.at);

    case 'REMOTE_RINGING':
      if (!sameCall(state, event.callId) || state.phase !== 'outgoing') return state;
      return { ...state, phase: 'ringing' };

    case 'REMOTE_ACCEPTED':
      if (!sameCall(state, event.callId)) return state;
      if (state.direction !== 'outgoing') return state;
      if (state.phase !== 'outgoing' && state.phase !== 'ringing') return state;
      return { ...state, phase: 'connecting', accepted: true };

    case 'INCOMING':
      if (isLive(state.phase)) return state; // the controller auto-declines as busy
      if (state.phase === 'ended' && state.callId === event.callId) return state; // stale replay
      return {
        ...initialCallState,
        phase: 'incoming',
        callId: event.callId,
        direction: 'incoming',
        media: event.media,
        peer: event.peer,
        conversationId: event.conversationId,
        startedAt: event.at,
      };

    case 'ACCEPT':
      if (!sameCall(state, event.callId) || state.phase !== 'incoming' || state.accepting) {
        return state;
      }
      return { ...state, phase: 'connecting', accepting: true };

    case 'ACCEPT_ACKED':
      if (!sameCall(state, event.callId) || state.phase !== 'connecting') return state;
      return { ...state, accepted: true, accepting: false };

    case 'ACCEPT_FAILED':
      if (!sameCall(state, event.callId) || !isLive(state.phase)) return state;
      return end(state, event.reason, event.at);

    case 'MEDIA_CONNECTED':
      if (state.phase !== 'connecting' && state.phase !== 'reconnecting') return state;
      return {
        ...state,
        phase: 'connected',
        connectedAt: state.connectedAt ?? event.at,
      };

    case 'MEDIA_INTERRUPTED':
      if (state.phase !== 'connected') return state;
      return { ...state, phase: 'reconnecting', reconnects: state.reconnects + 1 };

    case 'SERVER_ENDED':
      if (!sameCall(state, event.callId) || !isLive(state.phase)) return state;
      return end(state, event.reason, event.at);

    case 'HANGUP':
      if (!isLive(state.phase)) return state;
      return end(state, hangupReason(state), event.at);

    case 'LOCAL_FAILURE':
      if (!isLive(state.phase)) return state;
      return end(state, event.reason, event.at);

    case 'RESET':
      return state.phase === 'ended' || state.phase === 'idle' ? initialCallState : state;

    default:
      return state;
  }
}

/** Seconds of connected talk time (0 if never connected). */
export function callDurationSec(state: CallMachineState, now: number): number {
  if (state.connectedAt === null) return 0;
  const until = state.endedAt ?? now;
  return Math.max(0, Math.floor((until - state.connectedAt) / 1000));
}

export interface EndCopy {
  title: string;
  body: string | null;
  /** Show the end screen at all (answered elsewhere just closes silently). */
  silent: boolean;
  /** Offer "Call again". */
  canRetry: boolean;
}

/** User-facing copy for an ended call. */
export function endCopy(state: CallMachineState): EndCopy {
  const name = state.peer?.display_name ?? 'They';
  const outgoing = state.direction === 'outgoing';
  switch (state.endReason) {
    case 'completed':
      return { title: 'Call ended', body: null, silent: false, canRetry: true };
    case 'busy':
      return {
        title: `${name} is on another call`,
        body: 'Try again in a little while.',
        silent: false,
        canRetry: true,
      };
    case 'declined':
      return outgoing
        ? { title: `${name} declined`, body: null, silent: false, canRetry: true }
        : { title: 'Call declined', body: null, silent: true, canRetry: false };
    case 'timeout':
    case 'missed':
      return outgoing
        ? { title: 'No answer', body: `${name} didn't pick up.`, silent: false, canRetry: true }
        : { title: 'Missed call', body: null, silent: false, canRetry: true };
    case 'cancelled':
      return outgoing
        ? { title: 'Call cancelled', body: null, silent: true, canRetry: true }
        : { title: 'Missed call', body: `${name} hung up.`, silent: false, canRetry: true };
    case 'answered_elsewhere':
      return { title: 'Answered on another device', body: null, silent: true, canRetry: false };
    case 'permission_denied':
      return {
        title: state.media === 'video' ? 'Camera or microphone blocked' : 'Microphone blocked',
        body: 'Allow access in Settings to make calls.',
        silent: false,
        canRetry: false,
      };
    case 'media_error':
      return {
        title: "Couldn't start your camera or microphone",
        body: 'Another app may be using it.',
        silent: false,
        canRetry: true,
      };
    case 'in_another_call':
      return {
        title: "You're already in a call",
        body: 'Finish it on your other device first.',
        silent: false,
        canRetry: false,
      };
    case 'rate_limited':
      return {
        title: 'Too many calls',
        body: 'Wait a minute before calling again.',
        silent: false,
        canRetry: false,
      };
    case 'offline':
      return {
        title: "You're offline",
        body: 'Calls need a connection.',
        silent: false,
        canRetry: true,
      };
    case 'failed':
      return {
        title: 'Call dropped',
        body: 'The connection was lost.',
        silent: false,
        canRetry: true,
      };
    default:
      return { title: 'Call failed', body: 'Please try again.', silent: false, canRetry: true };
  }
}
