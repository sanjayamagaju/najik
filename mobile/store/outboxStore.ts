import { create } from 'zustand';

export type OutboxStatus = 'queued' | 'inflight' | 'failed';

/** An unacknowledged text send. Persisted so it survives app kill; idempotent by client_id. */
export interface OutboxEntry {
  client_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  attempts: number;
  status: OutboxStatus;
  /** Epoch ms before which the entry must not be retried (rate limits / backoff). */
  not_before: number;
  last_error: string | null;
}

interface OutboxState {
  entries: Record<string, OutboxEntry>;
  hydrate: (entries: OutboxEntry[]) => void;
  enqueue: (entry: Omit<OutboxEntry, 'attempts' | 'status' | 'not_before' | 'last_error'>) => void;
  markInflight: (clientId: string) => void;
  /** Back to queued after a transient failure. */
  requeue: (
    clientId: string,
    opts: { notBefore: number; error: string; countAttempt: boolean },
  ) => void;
  markFailed: (clientId: string, error: string) => void;
  /** User tapped "retry" on a failed message. */
  retry: (clientId: string) => void;
  remove: (clientId: string) => void;
  reset: () => void;
}

function patch(
  state: OutboxState,
  clientId: string,
  fn: (entry: OutboxEntry) => OutboxEntry,
): Partial<OutboxState> | OutboxState {
  const entry = state.entries[clientId];
  if (!entry) return state;
  return { entries: { ...state.entries, [clientId]: fn(entry) } };
}

export const useOutboxStore = create<OutboxState>()((set) => ({
  entries: {},
  hydrate: (entries) =>
    set({
      // Anything that was in flight when the app died is simply retried (idempotent by client_id).
      entries: Object.fromEntries(
        entries.map((e) => [
          e.client_id,
          e.status === 'inflight' ? { ...e, status: 'queued' as const } : e,
        ]),
      ),
    }),
  enqueue: (entry) =>
    set((state) =>
      state.entries[entry.client_id]
        ? state
        : {
            entries: {
              ...state.entries,
              [entry.client_id]: {
                ...entry,
                attempts: 0,
                status: 'queued',
                not_before: 0,
                last_error: null,
              },
            },
          },
    ),
  markInflight: (clientId) =>
    set((state) => patch(state, clientId, (e) => ({ ...e, status: 'inflight' }))),
  requeue: (clientId, { notBefore, error, countAttempt }) =>
    set((state) =>
      patch(state, clientId, (e) => ({
        ...e,
        status: 'queued',
        attempts: countAttempt ? e.attempts + 1 : e.attempts,
        not_before: notBefore,
        last_error: error,
      })),
    ),
  markFailed: (clientId, error) =>
    set((state) => patch(state, clientId, (e) => ({ ...e, status: 'failed', last_error: error }))),
  retry: (clientId) =>
    set((state) =>
      patch(state, clientId, (e) => ({
        ...e,
        status: 'queued',
        attempts: 0,
        not_before: 0,
        last_error: null,
      })),
    ),
  remove: (clientId) =>
    set((state) => {
      if (!state.entries[clientId]) return state;
      const entries = { ...state.entries };
      delete entries[clientId];
      return { entries };
    }),
  reset: () => set({ entries: {} }),
}));

export function selectOrderedOutbox(state: Pick<OutboxState, 'entries'>): OutboxEntry[] {
  return Object.values(state.entries).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function isOutboxEntry(v: unknown): v is OutboxEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.client_id === 'string' &&
    typeof e.conversation_id === 'string' &&
    typeof e.sender_id === 'string' &&
    typeof e.body === 'string' &&
    typeof e.created_at === 'string' &&
    typeof e.attempts === 'number' &&
    (e.status === 'queued' || e.status === 'inflight' || e.status === 'failed') &&
    typeof e.not_before === 'number'
  );
}
