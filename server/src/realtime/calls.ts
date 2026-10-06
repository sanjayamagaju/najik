import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { messages, type CallMeta } from '../db/messages.js';
import { toPublicUser, users } from '../db/users.js';
import { isOnline } from './presence.js';
import { pushTokens } from '../db/pushTokens.js';
import { pushCallEnded, pushEnabled, pushIncomingCall } from '../push/fcm.js';
import { ackOf, userRoom, type AppServer, type AppSocket } from './context.js';

type Media = 'audio' | 'video';

interface Call {
  id: string;
  callerId: string;
  calleeId: string;
  media: Media;
  state: 'ringing' | 'active';
  callerSocket: string;
  calleeSocket: string | null;
  createdAt: number;
  answeredAt: number | null;
  ringTimer: NodeJS.Timeout | null;
  /** Pending hang-up timers while a participant's socket is reconnecting. */
  graceTimers: Map<string, NodeJS.Timeout>;
}

const RECONNECT_GRACE_MS = 20_000;
const MAX_SIGNAL_BYTES = 64 * 1024;

const calls = new Map<string, Call>();
const callOfUser = new Map<string, string>();

const inviteSchema = z.object({ to: z.string().uuid(), media: z.enum(['audio', 'video']) });
const callIdSchema = z.object({ callId: z.string().uuid() });
const signalSchema = z.object({
  callId: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()),
});

let io: AppServer;

export function initCalls(server: AppServer): void {
  io = server;
}

function otherParty(call: Call, userId: string): string {
  return call.callerId === userId ? call.calleeId : call.callerId;
}

function socketOf(call: Call, userId: string): string | null {
  return call.callerId === userId ? call.callerSocket : call.calleeSocket;
}

/**
 * True when another, still-connected device of this user is the one bound to
 * the call — e.g. the user answered on their phone and a tablet also rang.
 */
function boundElsewhere(call: Call, userId: string, socketId: string): boolean {
  const bound = socketOf(call, userId);
  return !!bound && bound !== socketId && io.sockets.sockets.has(bound);
}

/** Writes a call-log message into the conversation and pushes it to both users. */
function logCall(callerId: string, calleeId: string, meta: CallMeta): void {
  const { message } = messages.create({
    senderId: callerId,
    recipientId: calleeId,
    kind: 'call',
    body: '',
    meta,
  });
  io.to(userRoom(callerId)).emit('message:new', message);
  io.to(userRoom(calleeId)).emit('message:new', message);
}

function finish(call: Call, outcome: CallMeta['outcome']): void {
  if (!calls.has(call.id)) return;
  // Dismiss the ringing notification on the callee's phones.
  if (call.state === 'ringing') pushCallEnded(call.calleeId, call.id, outcome);
  if (call.ringTimer) clearTimeout(call.ringTimer);
  for (const t of call.graceTimers.values()) clearTimeout(t);
  calls.delete(call.id);
  if (callOfUser.get(call.callerId) === call.id) callOfUser.delete(call.callerId);
  if (callOfUser.get(call.calleeId) === call.id) callOfUser.delete(call.calleeId);

  const payload = { callId: call.id, reason: outcome };
  io.to(userRoom(call.callerId)).emit('call:ended', payload);
  io.to(userRoom(call.calleeId)).emit('call:ended', payload);

  const durationSec = call.answeredAt ? Math.round((Date.now() - call.answeredAt) / 1000) : 0;
  logCall(call.callerId, call.calleeId, { media: call.media, outcome, durationSec });
}

export function registerCallHandlers(socket: AppSocket): void {
  const me = socket.data.user;

  const participantCall = (raw: unknown): Call | null => {
    const parsed = callIdSchema.safeParse(raw);
    if (!parsed.success) return null;
    const call = calls.get(parsed.data.callId);
    if (!call || (call.callerId !== me.id && call.calleeId !== me.id)) return null;
    return call;
  };

  socket.on('call:invite', (raw, cb) => {
    const ack = ackOf<{ callId: string }>(cb);
    const parsed = inviteSchema.safeParse(raw);
    if (!parsed.success) return ack({ ok: false, error: 'Invalid call request' });
    const { to, media } = parsed.data;
    const callee = users.findById(to);
    if (!callee || to === me.id) return ack({ ok: false, error: 'Unknown user' });
    if (callOfUser.has(me.id)) return ack({ ok: false, error: 'You are already in a call' });

    // Offline users can still be rung through a push notification.
    const reachableByPush = pushEnabled() && pushTokens.hasAny(to);
    if (!isOnline(to) && !reachableByPush) {
      logCall(me.id, to, { media, outcome: 'missed', durationSec: 0 });
      return ack({ ok: false, error: `${callee.display_name} is offline` });
    }
    if (callOfUser.has(to)) {
      logCall(me.id, to, { media, outcome: 'missed', durationSec: 0 });
      return ack({ ok: false, error: `${callee.display_name} is on another call` });
    }

    const call: Call = {
      id: randomUUID(),
      callerId: me.id,
      calleeId: to,
      media,
      state: 'ringing',
      callerSocket: socket.id,
      calleeSocket: null,
      createdAt: Date.now(),
      answeredAt: null,
      ringTimer: null,
      graceTimers: new Map(),
    };
    call.ringTimer = setTimeout(() => finish(call, 'missed'), env.CALL_RING_TIMEOUT_SECONDS * 1000);
    calls.set(call.id, call);
    callOfUser.set(me.id, call.id);
    callOfUser.set(to, call.id);

    ack({ ok: true, callId: call.id });
    if (isOnline(to)) {
      io.to(userRoom(to)).emit('call:incoming', { callId: call.id, from: toPublicUser(me), media });
      socket.emit('call:ringing', { callId: call.id });
    }
    // Also push: the app may be backgrounded or closed even while a socket lingers.
    // The native side ignores the push when the app is in the foreground.
    if (reachableByPush) pushIncomingCall(to, { callId: call.id, caller: toPublicUser(me), media });
  });

  socket.on('call:accept', (raw, cb) => {
    const ack = ackOf(cb);
    const call = participantCall(raw);
    if (!call || call.calleeId !== me.id || call.state !== 'ringing') {
      return ack({ ok: false, error: 'This call is no longer available' });
    }
    if (call.ringTimer) clearTimeout(call.ringTimer);
    call.ringTimer = null;
    call.state = 'active';
    call.calleeSocket = socket.id;
    call.answeredAt = Date.now();

    io.to(call.callerSocket).emit('call:accepted', { callId: call.id });
    // Stop ringing on the callee's other devices (open apps and notifications).
    socket.to(userRoom(me.id)).emit('call:ended', { callId: call.id, reason: 'answered-elsewhere' });
    pushCallEnded(me.id, call.id, 'answered-elsewhere');
    ack({ ok: true });
  });

  socket.on('call:reject', (raw) => {
    const call = participantCall(raw);
    if (call && call.calleeId === me.id && call.state === 'ringing') finish(call, 'declined');
  });

  socket.on('call:end', (raw) => {
    const call = participantCall(raw);
    if (!call) return;
    // Only the device actually in the call may end it.
    if (boundElsewhere(call, me.id, socket.id)) return;
    if (call.state === 'active') finish(call, 'completed');
    else finish(call, call.callerId === me.id ? 'cancelled' : 'declined');
  });

  /** Relays SDP / ICE / control payloads to the other participant's bound socket. */
  socket.on('call:signal', (raw) => {
    const parsed = signalSchema.safeParse(raw);
    if (!parsed.success) return;
    const call = calls.get(parsed.data.callId);
    if (!call || call.state !== 'active') return;
    if (socketOf(call, me.id) !== socket.id) return;
    if (JSON.stringify(parsed.data.payload).length > MAX_SIGNAL_BYTES) return;
    const target = socketOf(call, otherParty(call, me.id));
    if (target) io.to(target).emit('call:signal', { callId: call.id, payload: parsed.data.payload });
  });

  /** After a socket reconnect, re-bind this device to its in-progress call. */
  socket.on('call:rejoin', (raw, cb) => {
    const ack = ackOf<{ state: Call['state'] }>(cb);
    const call = participantCall(raw);
    if (!call) return ack({ ok: false, error: 'Call has ended' });
    // Another of this user's devices owns the call (e.g. answered elsewhere): don't hijack it.
    if (boundElsewhere(call, me.id, socket.id)) return ack({ ok: false, error: 'answered-elsewhere' });
    if (call.state === 'ringing' && call.calleeId === me.id) return ack({ ok: true, state: call.state });
    if (call.callerId === me.id) call.callerSocket = socket.id;
    else if (call.state === 'active') call.calleeSocket = socket.id;

    const timer = call.graceTimers.get(me.id);
    if (timer) {
      clearTimeout(timer);
      call.graceTimers.delete(me.id);
    }
    const peerSocket = socketOf(call, otherParty(call, me.id));
    if (peerSocket) io.to(peerSocket).emit('call:peer-reconnected', { callId: call.id });
    ack({ ok: true, state: call.state });
  });

  socket.on('disconnect', () => {
    const callId = callOfUser.get(me.id);
    const call = callId ? calls.get(callId) : undefined;
    if (!call || socketOf(call, me.id) !== socket.id) return;

    const peerSocket = socketOf(call, otherParty(call, me.id));
    if (peerSocket) io.to(peerSocket).emit('call:peer-reconnecting', { callId: call.id });

    // Media may still be flowing peer-to-peer; give signaling time to come back.
    call.graceTimers.set(
      me.id,
      setTimeout(() => {
        const live = calls.get(call.id);
        if (!live) return;
        if (live.state === 'active') finish(live, 'completed');
        else finish(live, live.callerId === me.id ? 'cancelled' : 'missed');
      }, RECONNECT_GRACE_MS),
    );
  });
}

/**
 * A device that (re)connects while a call to its user is still ringing gets
 * the call delivered — this is how tapping the push notification lands the
 * user on the incoming-call screen.
 */
export function deliverPendingCall(socket: AppSocket): void {
  const me = socket.data.user;
  const callId = callOfUser.get(me.id);
  const call = callId ? calls.get(callId) : undefined;
  if (!call || call.calleeId !== me.id || call.state !== 'ringing') return;
  const caller = users.findById(call.callerId);
  if (!caller) return;
  socket.emit('call:incoming', { callId: call.id, from: toPublicUser(caller), media: call.media });
  io.to(call.callerSocket).emit('call:ringing', { callId: call.id });
}

/** Decline from outside a socket (notification action). Returns false if not ringing. */
export function declineCall(userId: string, callId: string): boolean {
  const call = calls.get(callId);
  if (!call || call.calleeId !== userId || call.state !== 'ringing') return false;
  finish(call, 'declined');
  return true;
}

/** Ends the user's current call right away (e.g. on logout) instead of waiting out the reconnect grace. */
export function endCallOf(userId: string): void {
  const callId = callOfUser.get(userId);
  const call = callId ? calls.get(callId) : undefined;
  if (!call) return;
  if (call.state === 'active') finish(call, 'completed');
  else finish(call, call.callerId === userId ? 'cancelled' : 'declined');
}
