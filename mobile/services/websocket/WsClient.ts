import type {
  AppStateValue,
  ClientRequestMap,
  ClientRequestType,
  ServerEventMap,
  ServerEventType,
  WsAckError,
  WsAuthAck,
} from '@/types/protocol';
import { fullJitterBackoff } from '@/utils/backoff';

/**
 * WebSocket client implementing PROTOCOL §4:
 *  - first-frame `auth` (token never in the URL), 10 s auth deadline,
 *  - request/ack correlation with per-request timeouts,
 *  - `hb` heartbeat every `heartbeat_sec`; no reply within 10 s ⇒ socket is dead ⇒ reconnect,
 *  - exponential backoff with full jitter (base 0.5 s, cap 30 s), ≥ 5 s after 4008,
 *  - close-code handling (4001/4003/4004/4008/4009/1001),
 *  - network + AppState awareness (immediate reconnect on network-up / foreground),
 *  - `app.state` frames, typed server events.
 *
 * Pure TypeScript: no React Native imports, so it is fully unit-testable with a mock socket.
 */

export type WsState =
  'idle' | 'connecting' | 'authenticating' | 'open' | 'backoff' | 'offline' | 'stopped';

export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type AuthRejectionReason = 'ws_4004' | 'session_revoked' | 'token_invalid';

export interface WsClientOptions {
  url: string;
  /** A currently-valid access token (proactively refreshed), or null when signed out. */
  getAccessToken: () => Promise<string | null>;
  /** Forces a refresh (after close 4003 / auth ack `token_expired`). Null ⇒ session is gone. */
  refreshAccessToken: () => Promise<string | null>;
  /** Called once when the server rejects the session; the client stops itself. */
  onAuthRejected: (reason: AuthRejectionReason) => void;
  createSocket?: (url: string) => WebSocketLike;
  random?: () => number;
  authTimeoutMs?: number;
  ackTimeoutMs?: number;
  heartbeatReplyTimeoutMs?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
  rateLimitedMinDelayMs?: number;
  maxFrameBytes?: number;
}

export type WsErrorCode =
  | 'not_connected'
  | 'ack_timeout'
  | 'disconnected'
  | 'frame_too_large'
  | 'rate_limited'
  | (string & {});

export class WsRequestError extends Error {
  readonly code: WsErrorCode;
  readonly retryAfterSec: number | null;
  readonly details: Record<string, string[]>;
  constructor(
    code: WsErrorCode,
    message: string,
    retryAfterSec: number | null = null,
    details: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = 'WsRequestError';
    this.code = code;
    this.retryAfterSec = retryAfterSec;
    this.details = details;
  }
}

export const CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  AUTH_TIMEOUT: 4001,
  TOKEN_EXPIRED: 4003,
  AUTH_INVALID: 4004,
  RATE_LIMITED: 4008,
  FRAME_INVALID: 4009,
} as const;

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: WsRequestError) => void;
  timer: ReturnType<typeof setTimeout>;
}

type AnyHandler = (data: unknown) => void;

interface AckFrame {
  type: 'ack';
  id: string;
  ok: boolean;
  data?: unknown;
  error?: WsAckError & { retry_after_sec?: number };
}

export class WsClient {
  private socket: WebSocketLike | null = null;
  private generation = 0;
  private state: WsState = 'idle';
  private started = false;
  private networkAvailable = true;
  private appState: AppStateValue = 'active';
  private attempt = 0;
  private hasConnectedBefore = false;
  private nextId = 1;
  private heartbeatSec = 25;
  private connectInFlight = false;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatReplyTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly pending = new Map<string, PendingRequest>();
  private readonly handlers = new Map<string, Set<AnyHandler>>();
  private readonly stateListeners = new Set<(state: WsState) => void>();
  private readonly authListeners = new Set<
    (ack: WsAuthAck, info: { reconnect: boolean }) => void
  >();

  private readonly opts: Required<Omit<WsClientOptions, 'createSocket' | 'random'>> & {
    createSocket: (url: string) => WebSocketLike;
    random: () => number;
  };

  constructor(options: WsClientOptions) {
    this.opts = {
      authTimeoutMs: 10_000,
      ackTimeoutMs: 10_000,
      heartbeatReplyTimeoutMs: 10_000,
      backoffBaseMs: 500,
      backoffCapMs: 30_000,
      rateLimitedMinDelayMs: 5_000,
      maxFrameBytes: 64 * 1024,
      createSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
      random: Math.random,
      ...options,
    };
  }

  // ───────────────────────── public API ─────────────────────────

  getState(): WsState {
    return this.state;
  }

  isOpen(): boolean {
    return this.state === 'open';
  }

  /** Begin maintaining a connection (call after sign-in). Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.attempt = 0;
    if (this.networkAvailable) void this.connect();
    else this.setState('offline');
  }

  /** Close and stop reconnecting (sign-out). */
  stop(): void {
    this.started = false;
    this.hasConnectedBefore = false;
    this.clearReconnectTimer();
    this.teardownSocket(CLOSE_CODES.NORMAL, 'client stop');
    this.setState('stopped');
  }

  /** Skip any pending backoff and reconnect now (no-op if already connected/connecting). */
  reconnectNow(): void {
    if (!this.started || !this.networkAvailable) return;
    if (this.socket || this.connectInFlight) return;
    this.clearReconnectTimer();
    this.attempt = 0;
    void this.connect();
  }

  setNetworkAvailable(available: boolean): void {
    if (this.networkAvailable === available) return;
    this.networkAvailable = available;
    if (!this.started) return;
    if (!available) {
      this.clearReconnectTimer();
      if (!this.socket) this.setState('offline');
      return;
    }
    if (this.socket) {
      this.probe();
    } else {
      this.reconnectNow();
    }
  }

  setAppState(state: AppStateValue): void {
    if (this.appState === state) return;
    this.appState = state;
    if (this.state === 'open') this.send('app.state', { state });
    if (state === 'active' && this.started) {
      if (this.socket) this.probe();
      else this.reconnectNow();
    }
  }

  /** Typed subscription to server pushes. Returns an unsubscribe function. */
  on<K extends ServerEventType>(type: K, handler: (data: ServerEventMap[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as AnyHandler);
    return () => {
      set.delete(handler as AnyHandler);
    };
  }

  onStateChange(listener: (state: WsState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /** Fires after every successful auth; `reconnect` is true for every connection after the first. */
  onAuthenticated(listener: (ack: WsAuthAck, info: { reconnect: boolean }) => void): () => void {
    this.authListeners.add(listener);
    return () => {
      this.authListeners.delete(listener);
    };
  }

  /**
   * Pushes a refreshed access token over the open socket (a second `auth` frame is acked by the
   * server), so token rotation never forces a reconnect.
   */
  reauthenticate(token: string): void {
    if (this.state !== 'open') return;
    this.sendWithAck('auth', { token }, this.opts.authTimeoutMs).catch((error: unknown) => {
      if (!(error instanceof WsRequestError)) return;
      if (error.code === 'token_invalid' || error.code === 'session_revoked') {
        this.rejectSession(error.code === 'token_invalid' ? 'token_invalid' : 'session_revoked');
      }
    });
  }

  /** Request with an id ⇒ resolves with the ack `data`, rejects with WsRequestError. */
  request<K extends ClientRequestType>(
    type: K,
    data: ClientRequestMap[K]['data'],
    options: { timeoutMs?: number } = {},
  ): Promise<ClientRequestMap[K]['ack']> {
    if (this.state !== 'open') {
      return Promise.reject(new WsRequestError('not_connected', 'Socket is not connected'));
    }
    return this.sendWithAck(type, data, options.timeoutMs ?? this.opts.ackTimeoutMs) as Promise<
      ClientRequestMap[K]['ack']
    >;
  }

  /** Fire-and-forget frame (no id, no ack). Returns false when not connected. */
  send<K extends ClientRequestType>(type: K, data: ClientRequestMap[K]['data']): boolean {
    if (this.state !== 'open' || !this.socket) return false;
    return this.writeFrame({ type, data });
  }

  // ───────────────────────── connection ─────────────────────────

  private async connect(): Promise<void> {
    if (!this.started || this.socket || this.connectInFlight) return;
    this.connectInFlight = true;
    this.setState('connecting');
    let token: string | null;
    try {
      token = await this.opts.getAccessToken();
    } catch {
      // Refresh failed for a transient reason (network) — retry with backoff.
      this.connectInFlight = false;
      this.scheduleReconnect();
      return;
    }
    this.connectInFlight = false;
    if (!this.started) return;
    if (!token) {
      // Session is gone: nothing to connect with.
      this.stop();
      return;
    }

    const generation = ++this.generation;
    let socket: WebSocketLike;
    try {
      socket = this.opts.createSocket(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (generation !== this.generation) return;
      this.authenticate(token);
    };
    socket.onmessage = (event) => {
      if (generation !== this.generation) return;
      this.handleFrame(event.data);
    };
    socket.onerror = () => {
      // An error is always followed by close; handled there.
    };
    socket.onclose = (event) => {
      if (generation !== this.generation) return;
      this.handleClose(event.code);
    };
  }

  private authenticate(token: string): void {
    this.setState('authenticating');
    this.sendWithAck('auth', { token }, this.opts.authTimeoutMs, true)
      .then((ack) => this.handleAuthenticated(ack as WsAuthAck))
      .catch((error: unknown) => {
        if (!(error instanceof WsRequestError)) return;
        if (error.code === 'disconnected') return; // close handler takes over
        if (error.code === 'ack_timeout') {
          this.dropSocket();
          return;
        }
        if (error.code === 'token_expired') {
          this.refreshThenReconnect();
          return;
        }
        if (error.code === 'token_invalid' || error.code === 'session_revoked') {
          this.rejectSession(error.code === 'token_invalid' ? 'token_invalid' : 'session_revoked');
          return;
        }
        this.dropSocket();
      });
  }

  private handleAuthenticated(ack: WsAuthAck): void {
    const reconnect = this.hasConnectedBefore;
    this.hasConnectedBefore = true;
    this.attempt = 0;
    this.heartbeatSec = ack.heartbeat_sec > 0 ? ack.heartbeat_sec : 25;
    this.setState('open');
    this.startHeartbeat();
    this.send('app.state', { state: this.appState });
    for (const listener of this.authListeners) listener(ack, { reconnect });
  }

  private handleClose(code: number): void {
    this.cleanupSocket();
    if (!this.started) return;
    switch (code) {
      case CLOSE_CODES.AUTH_INVALID:
        this.rejectSession('ws_4004');
        return;
      case CLOSE_CODES.TOKEN_EXPIRED:
        this.refreshThenReconnect();
        return;
      case CLOSE_CODES.RATE_LIMITED:
        this.scheduleReconnect(this.opts.rateLimitedMinDelayMs);
        return;
      default:
        // 4001 (auth timeout), 4009 (frame), 1001 (going away), 1006 (abnormal), …
        this.scheduleReconnect();
    }
  }

  private refreshThenReconnect(): void {
    this.teardownSocket(CLOSE_CODES.NORMAL, 'refreshing token');
    if (!this.started) return;
    this.setState('connecting');
    this.connectInFlight = true;
    this.opts
      .refreshAccessToken()
      .then((token) => {
        this.connectInFlight = false;
        if (!this.started) return;
        if (!token) {
          this.stop();
          return;
        }
        this.attempt += 1;
        void this.connect();
      })
      .catch(() => {
        this.connectInFlight = false;
        this.scheduleReconnect();
      });
  }

  private rejectSession(reason: AuthRejectionReason): void {
    this.stop();
    this.opts.onAuthRejected(reason);
  }

  private scheduleReconnect(minDelayMs = 0): void {
    this.clearReconnectTimer();
    if (!this.started) return;
    if (!this.networkAvailable) {
      this.setState('offline');
      return;
    }
    const delay = Math.max(
      minDelayMs,
      fullJitterBackoff(
        this.attempt,
        { baseMs: this.opts.backoffBaseMs, capMs: this.opts.backoffCapMs },
        this.opts.random,
      ),
    );
    this.attempt += 1;
    this.setState('backoff');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  /** Treat the current socket as dead: detach, close, and reconnect with backoff. */
  private dropSocket(): void {
    this.teardownSocket(CLOSE_CODES.NORMAL, 'dead');
    if (this.started) this.scheduleReconnect();
  }

  private teardownSocket(code: number, reason: string): void {
    const socket = this.socket;
    this.generation += 1; // ignore any late events from the old socket
    this.cleanupSocket();
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close(code, reason);
      } catch {
        // already closed
      }
    }
  }

  private cleanupSocket(): void {
    this.socket = null;
    this.stopHeartbeat();
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) {
      clearTimeout(p.timer);
      p.reject(new WsRequestError('disconnected', 'Socket closed before ack'));
    }
  }

  // ───────────────────────── heartbeat ─────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), this.heartbeatSec * 1000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.heartbeatReplyTimer) clearTimeout(this.heartbeatReplyTimer);
    this.heartbeatTimer = null;
    this.heartbeatReplyTimer = null;
  }

  private sendHeartbeat(): void {
    if (!this.socket || this.state !== 'open') return;
    // The server echoes `{"type":"hb","id":X}`; any inbound frame also proves liveness.
    this.writeFrame({ type: 'hb', id: `hb-${this.nextId++}` });
    if (this.heartbeatReplyTimer) return;
    this.heartbeatReplyTimer = setTimeout(() => {
      this.heartbeatReplyTimer = null;
      this.dropSocket();
    }, this.opts.heartbeatReplyTimeoutMs);
  }

  /** Immediate liveness check (foreground / network change). */
  private probe(): void {
    if (this.state === 'open') this.sendHeartbeat();
  }

  // ───────────────────────── frames ─────────────────────────

  private sendWithAck(
    type: string,
    data: unknown,
    timeoutMs: number,
    allowBeforeOpen = false,
  ): Promise<unknown> {
    if (!this.socket || (!allowBeforeOpen && this.state !== 'open')) {
      return Promise.reject(new WsRequestError('not_connected', 'Socket is not connected'));
    }
    const id = String(this.nextId++);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new WsRequestError('ack_timeout', `No ack for ${type}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.writeFrame({ type, id, data })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new WsRequestError('frame_too_large', 'Frame exceeds the 64 KiB limit'));
      }
    });
  }

  private writeFrame(frame: { type: string; id?: string; data?: unknown }): boolean {
    if (!this.socket) return false;
    const serialized = JSON.stringify(frame);
    // UTF-8 upper bound: 3 bytes per UTF-16 code unit.
    if (
      serialized.length * 3 > this.opts.maxFrameBytes &&
      utf8Length(serialized) > this.opts.maxFrameBytes
    ) {
      return false;
    }
    try {
      this.socket.send(serialized);
      return true;
    } catch {
      return false;
    }
  }

  private handleFrame(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let frame: { type?: unknown; id?: unknown; data?: unknown };
    try {
      frame = JSON.parse(raw) as typeof frame;
    } catch {
      return;
    }
    if (!frame || typeof frame.type !== 'string') return;

    // Any inbound traffic proves the socket is alive.
    if (this.heartbeatReplyTimer) {
      clearTimeout(this.heartbeatReplyTimer);
      this.heartbeatReplyTimer = null;
    }

    if (frame.type === 'hb') return;
    if (frame.type === 'ack') {
      this.handleAck(frame as unknown as AckFrame);
      return;
    }
    this.emit(frame.type, frame.data ?? {});
    if (frame.type === 'session.revoked') {
      this.rejectSession('session_revoked');
    }
  }

  private handleAck(ack: AckFrame): void {
    const pending = this.pending.get(String(ack.id));
    if (!pending) return;
    this.pending.delete(String(ack.id));
    clearTimeout(pending.timer);
    if (ack.ok) {
      pending.resolve(ack.data ?? {});
    } else {
      const code = ack.error?.code ?? 'unknown';
      pending.reject(
        new WsRequestError(
          code,
          ack.error?.message ?? code,
          ack.error?.retry_after_sec ?? null,
          ack.error?.details ?? {},
        ),
      );
    }
  }

  private emit(type: string, data: unknown): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(data);
      } catch {
        // A faulty subscriber must never break the socket loop.
      }
    }
  }

  private setState(next: WsState): void {
    if (this.state === next) return;
    this.state = next;
    for (const listener of this.stateListeners) listener(next);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

export function utf8Length(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}
