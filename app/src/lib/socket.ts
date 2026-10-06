import { io, type Socket } from 'socket.io-client';
import { getServerUrl } from './config';
import { tokenStore } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function connectSocket(): Socket {
  if (socket) return socket;
  const url = getServerUrl() || undefined;
  socket = io(url, {
    auth: (cb) => cb({ token: tokenStore.get() }),
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 10000,
  });
  return socket;
}

export function disconnectSocket(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

type AckResult<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Emit with acknowledgement, rejecting on server error or timeout. */
export function emitAck<T = object>(event: string, payload: unknown, timeoutMs = 8000): Promise<{ ok: true } & T> {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error("You're offline. Reconnecting…"));
      return;
    }
    socket.timeout(timeoutMs).emit(event, payload, (err: Error | null, res: AckResult<T>) => {
      if (err) reject(new Error('The server took too long to respond'));
      else if (!res.ok) reject(new Error(res.error));
      else resolve(res);
    });
  });
}

export function emit(event: string, payload: unknown): void {
  socket?.emit(event, payload);
}
