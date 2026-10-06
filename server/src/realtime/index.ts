import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { allowedOrigins } from '../config/env.js';
import { verifyToken } from '../auth/tokens.js';
import { users } from '../db/users.js';
import { messages } from '../db/messages.js';
import { TokenBucket } from '../utils/rateLimit.js';
import { addSocket, removeSocket } from './presence.js';
import { flushPendingDeliveries, registerChatHandlers } from './chat.js';
import { deliverPendingCall, initCalls, registerCallHandlers } from './calls.js';
import { userRoom, type AppServer } from './context.js';

let io: AppServer | null = null;

export function createRealtime(httpServer: HttpServer): AppServer {
  const server: AppServer = new Server(httpServer, {
    cors: {
      origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)),
    },
    // Fast detection of dead mobile connections.
    pingInterval: 10_000,
    pingTimeout: 8_000,
    maxHttpBufferSize: 256 * 1024,
  });
  io = server;
  initCalls(server);

  server.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    const user = verifyToken(typeof token === 'string' ? token : null);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    socket.data.limiter = new TokenBucket(40, 20);
    next();
  });

  server.on('connection', (socket) => {
    const me = socket.data.user;

    // Per-connection flood protection for every inbound event.
    // Call signaling is exempt: an ICE burst at call start must never be dropped
    // (it is already restricted to the two bound sockets of an active call).
    socket.use((packet, next) => {
      if (packet[0] === 'call:signal' || socket.data.limiter.take()) return next();
      const ack = packet[packet.length - 1];
      if (typeof ack === 'function') ack({ ok: false, error: 'Slow down a little' });
    });

    socket.join(userRoom(me.id));
    if (addSocket(me.id, socket.id)) broadcastPresence(server, me.id, true, null);
    flushPendingDeliveries(server, me.id);

    registerChatHandlers(server, socket);
    registerCallHandlers(socket);
    deliverPendingCall(socket);

    socket.on('disconnect', () => {
      if (removeSocket(me.id, socket.id)) {
        const at = Date.now();
        users.touchLastSeen(me.id, at);
        broadcastPresence(server, me.id, false, at);
      }
    });
  });

  return server;
}

/** Presence is only shared with people you have a conversation with. */
function broadcastPresence(server: AppServer, userId: string, online: boolean, lastSeen: number | null): void {
  const peers = messages.peersOf(userId);
  if (peers.length === 0) return;
  server.to(peers.map(userRoom)).emit('presence', { userId, online, lastSeen });
}

/** Forcefully disconnects every socket of a user (e.g. after logout). */
export function disconnectUser(userId: string): void {
  io?.in(userRoom(userId)).disconnectSockets(true);
}
