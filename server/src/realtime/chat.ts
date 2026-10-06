import { z } from 'zod';
import { messages } from '../db/messages.js';
import { users } from '../db/users.js';
import { isOnline } from './presence.js';
import { ackOf, userRoom, type AppServer, type AppSocket } from './context.js';

const sendSchema = z.object({
  to: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
  clientId: z.string().min(8).max(64),
});
const idsSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });
const peerSchema = z.object({ peerId: z.string().uuid() });
const typingSchema = z.object({ to: z.string().uuid(), typing: z.boolean() });
const pingSchema = z.object({ to: z.string().uuid(), clientId: z.string().min(8).max(64) });
const presenceSchema = z.object({ ids: z.array(z.string().uuid()).max(500) });

const PING_COOLDOWN_MS = 3000;

export function registerChatHandlers(io: AppServer, socket: AppSocket): void {
  const me = socket.data.user;
  const lastPing = new Map<string, number>();

  /** Fan a new message out to the recipient and to the sender's other devices. */
  const fanOut = (message: ReturnType<typeof messages.create>['message']) => {
    socket.to(userRoom(message.senderId)).emit('message:new', message);
    io.to(userRoom(message.recipientId)).emit('message:new', message);
  };

  socket.on('message:send', (raw, cb) => {
    const ack = ackOf<{ message: unknown }>(cb);
    const parsed = sendSchema.safeParse(raw);
    if (!parsed.success) return ack({ ok: false, error: 'Invalid message' });
    const { to, body, clientId } = parsed.data;
    if (to === me.id || !users.findById(to)) return ack({ ok: false, error: 'Unknown recipient' });

    const { message, duplicate } = messages.create({ senderId: me.id, recipientId: to, kind: 'text', body, clientId });
    ack({ ok: true, message });
    if (!duplicate) fanOut(message);
  });

  socket.on('ping:send', (raw, cb) => {
    const ack = ackOf<{ message: unknown }>(cb);
    const parsed = pingSchema.safeParse(raw);
    if (!parsed.success) return ack({ ok: false, error: 'Invalid ping' });
    const { to, clientId } = parsed.data;
    if (to === me.id || !users.findById(to)) return ack({ ok: false, error: 'Unknown recipient' });

    const now = Date.now();
    if (now - (lastPing.get(to) ?? 0) < PING_COOLDOWN_MS) {
      return ack({ ok: false, error: 'Easy there — wait a moment before pinging again' });
    }
    lastPing.set(to, now);

    const { message, duplicate } = messages.create({
      senderId: me.id,
      recipientId: to,
      kind: 'ping',
      body: '👋 Ping!',
      clientId,
    });
    ack({ ok: true, message });
    if (!duplicate) fanOut(message);
  });

  socket.on('message:delivered', (raw) => {
    const parsed = idsSchema.safeParse(raw);
    if (!parsed.success) return;
    const at = Date.now();
    for (const [senderId, ids] of messages.markDelivered(me.id, parsed.data.ids, at)) {
      io.to(userRoom(senderId)).emit('message:status', { ids, status: 'delivered', at });
    }
  });

  socket.on('message:read', (raw) => {
    const parsed = peerSchema.safeParse(raw);
    if (!parsed.success) return;
    const at = Date.now();
    const ids = messages.markRead(me.id, parsed.data.peerId, at);
    if (ids.length === 0) return;
    io.to(userRoom(parsed.data.peerId)).emit('message:status', { ids, status: 'read', at });
    // Keep the reader's other devices in sync (clears unread badges).
    socket.to(userRoom(me.id)).emit('conversation:read', { peerId: parsed.data.peerId, ids, at });
  });

  socket.on('typing', (raw) => {
    const parsed = typingSchema.safeParse(raw);
    if (!parsed.success || parsed.data.to === me.id) return;
    io.to(userRoom(parsed.data.to)).emit('typing', { from: me.id, typing: parsed.data.typing });
  });

  socket.on('presence:query', (raw, cb) => {
    const ack = ackOf<{ presence: Record<string, { online: boolean; lastSeen: number | null }> }>(cb);
    const parsed = presenceSchema.safeParse(raw);
    if (!parsed.success) return ack({ ok: false, error: 'Invalid query' });
    const presence: Record<string, { online: boolean; lastSeen: number | null }> = {};
    for (const id of parsed.data.ids) {
      const u = users.findById(id);
      if (u) presence[id] = { online: isOnline(id), lastSeen: u.last_seen };
    }
    ack({ ok: true, presence });
  });
}

/** On (re)connect, everything waiting for this user is now delivered. */
export function flushPendingDeliveries(io: AppServer, userId: string): void {
  const at = Date.now();
  for (const [senderId, ids] of messages.markAllDelivered(userId, at)) {
    io.to(userRoom(senderId)).emit('message:status', { ids, status: 'delivered', at });
  }
}
