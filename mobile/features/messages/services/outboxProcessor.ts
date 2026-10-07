import { selectOrderedOutbox, type OutboxEntry, useOutboxStore } from '@/store/outboxStore';
import type { Message } from '@/types/protocol';
import { fullJitterBackoff } from '@/utils/backoff';

/**
 * Drains the persisted outbox in order. Sends are idempotent by `client_id` (PROTOCOL §3/§4.2),
 * so anything unacked — including in-flight sends interrupted by an app kill — is simply resent.
 *
 * Ordering: entries are processed oldest-first; if one entry in a conversation has to wait
 * (rate limit / backoff), later entries of that conversation wait too so seq order matches
 * the order the user typed.
 */

export interface OutboxTransport {
  /** Network believed reachable (NetInfo). */
  isOnline(): boolean;
  isSocketOpen(): boolean;
  sendViaSocket(entry: OutboxEntry): Promise<Message>;
  sendViaRest(entry: OutboxEntry): Promise<Message>;
}

export interface OutboxProcessorDeps {
  transport: OutboxTransport;
  onAcked: (message: Message, entry: OutboxEntry) => void;
  onFailed: (entry: OutboxEntry) => void;
  /** The entry went back to "sending" (user retry). */
  onRequeued?: (entry: OutboxEntry) => void;
  now?: () => number;
  random?: () => number;
  maxAttempts?: number;
}

const PERMANENT_CODES = new Set([
  'validation_error',
  'forbidden',
  'not_found',
  'conflict',
  'invalid_body',
  'conversation_not_found',
]);
const OFFLINE_CODES = new Set(['not_connected', 'disconnected', 'network_error']);

interface ErrorLike {
  code?: unknown;
  retryAfterSec?: unknown;
  status?: unknown;
}

function classify(error: unknown): {
  kind: 'permanent' | 'rate_limited' | 'offline' | 'transient';
  retryAfterMs: number;
} {
  const e = (error ?? {}) as ErrorLike;
  const code = typeof e.code === 'string' ? e.code : 'unknown';
  const retryAfterSec = typeof e.retryAfterSec === 'number' ? e.retryAfterSec : null;
  if (code === 'rate_limited')
    return { kind: 'rate_limited', retryAfterMs: (retryAfterSec ?? 5) * 1000 };
  if (PERMANENT_CODES.has(code)) return { kind: 'permanent', retryAfterMs: 0 };
  if (
    typeof e.status === 'number' &&
    e.status >= 400 &&
    e.status < 500 &&
    e.status !== 408 &&
    e.status !== 401
  ) {
    return { kind: 'permanent', retryAfterMs: 0 };
  }
  if (OFFLINE_CODES.has(code)) return { kind: 'offline', retryAfterMs: 0 };
  return { kind: 'transient', retryAfterMs: 0 };
}

export function createOutboxProcessor(deps: OutboxProcessorDeps) {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const maxAttempts = deps.maxAttempts ?? 5;
  let running: Promise<void> | null = null;
  let rerun = false;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const store = () => useOutboxStore.getState();

  function scheduleWake(atMs: number) {
    const delay = Math.max(0, atMs - now());
    if (wakeTimer) clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      void flush();
    }, delay);
  }

  async function sendOne(entry: OutboxEntry): Promise<'sent' | 'blocked' | 'stop'> {
    const { transport } = deps;
    const useSocket = transport.isSocketOpen();
    if (!useSocket && !transport.isOnline()) return 'stop';
    store().markInflight(entry.client_id);
    try {
      const message = useSocket
        ? await transport.sendViaSocket(entry)
        : await transport.sendViaRest(entry);
      store().remove(entry.client_id);
      deps.onAcked(message, entry);
      return 'sent';
    } catch (error) {
      const { kind, retryAfterMs } = classify(error);
      const reason = String((error as ErrorLike | undefined)?.code ?? 'error');
      if (kind === 'permanent') {
        store().markFailed(entry.client_id, reason);
        deps.onFailed({ ...entry, status: 'failed' });
        return 'sent';
      }
      if (kind === 'rate_limited') {
        store().requeue(entry.client_id, {
          notBefore: now() + retryAfterMs,
          error: reason,
          countAttempt: false,
        });
        return 'blocked';
      }
      if (kind === 'offline') {
        store().requeue(entry.client_id, { notBefore: 0, error: reason, countAttempt: false });
        return 'stop';
      }
      const attempts = entry.attempts + 1;
      if (attempts >= maxAttempts) {
        store().markFailed(entry.client_id, reason);
        deps.onFailed({ ...entry, status: 'failed' });
        return 'sent';
      }
      const delay = 1000 + fullJitterBackoff(attempts, { baseMs: 1000, capMs: 30_000 }, random);
      store().requeue(entry.client_id, {
        notBefore: now() + delay,
        error: reason,
        countAttempt: true,
      });
      return 'blocked';
    }
  }

  async function drain(): Promise<void> {
    do {
      rerun = false;
      const blocked = new Set<string>();
      let earliestWake = Infinity;
      const queue = selectOrderedOutbox(store()).filter((e) => e.status === 'queued');
      for (const snapshot of queue) {
        if (disposed) return;
        const entry = store().entries[snapshot.client_id];
        if (!entry || entry.status !== 'queued') continue;
        if (blocked.has(entry.conversation_id)) continue;
        if (entry.not_before > now()) {
          blocked.add(entry.conversation_id);
          earliestWake = Math.min(earliestWake, entry.not_before);
          continue;
        }
        const result = await sendOne(entry);
        if (result === 'stop') return;
        if (result === 'blocked') {
          blocked.add(entry.conversation_id);
          const updated = store().entries[entry.client_id];
          if (updated) earliestWake = Math.min(earliestWake, updated.not_before);
        }
      }
      if (earliestWake !== Infinity) scheduleWake(earliestWake);
    } while (rerun && !disposed);
  }

  function flush(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (running) {
      rerun = true;
      return running;
    }
    running = drain().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    flush,
    /** User tapped "Tap to retry" on a failed message. */
    retry(clientId: string): Promise<void> {
      const entry = store().entries[clientId];
      if (!entry) return Promise.resolve();
      store().retry(clientId);
      deps.onRequeued?.(entry);
      return flush();
    },
    dispose() {
      disposed = true;
      if (wakeTimer) clearTimeout(wakeTimer);
      wakeTimer = null;
    },
    /** Re-enable after dispose (new session). */
    reset() {
      disposed = false;
    },
  };
}

export type OutboxProcessor = ReturnType<typeof createOutboxProcessor>;
