import type { Server, Socket } from 'socket.io';
import type { UserRow } from '../db/users.js';
import type { TokenBucket } from '../utils/rateLimit.js';

export interface SocketData {
  user: UserRow;
  limiter: TokenBucket;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEvents = { [event: string]: (...args: any[]) => void };

export type AppServer = Server<AnyEvents, AnyEvents, AnyEvents, SocketData>;
export type AppSocket = Socket<AnyEvents, AnyEvents, AnyEvents, SocketData>;

export type AckResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

export const userRoom = (userId: string) => `user:${userId}`;

/** Wraps an optional client ack callback so handlers can always call it. */
export function ackOf<T = unknown>(maybe: unknown): (r: AckResult<T>) => void {
  return typeof maybe === 'function' ? (maybe as (r: AckResult<T>) => void) : () => {};
}
