import type { Conversation, Message, MessageStatus } from '@/types/protocol';

/**
 * Pure, framework-free message model. The Zustand store is a thin wrapper around these so the
 * tricky parts (dedupe, ack reconciliation, gap detection, derived status) are unit-tested.
 */

export interface LocalMessage {
  client_id: string;
  conversation_id: string;
  sender_id: string;
  kind: 'text';
  body: string;
  created_at: string;
  /** `sending` while queued / in flight, `failed` once the outbox gave up. */
  state: 'sending' | 'failed';
}

export interface ConversationMessages {
  bySeq: Record<number, Message>;
  /** Ascending, unique. */
  seqs: number[];
  /** client_id → seq for every server message we hold (dedupe + ack reconciliation). */
  seqByClientId: Record<string, number>;
  /** Optimistic messages not yet acknowledged, oldest first. */
  local: LocalMessage[];
  /** Whether older history may exist before `seqs[0]`. */
  hasMoreOlder: boolean;
}

export const emptyConversationMessages = (): ConversationMessages => ({
  bySeq: {},
  seqs: [],
  seqByClientId: {},
  local: [],
  hasMoreOlder: true,
});

function insertSorted(seqs: number[], seq: number): number[] {
  // Fast path: appends at the end are by far the most common case.
  const last = seqs[seqs.length - 1];
  if (last === undefined || seq > last) return [...seqs, seq];
  let lo = 0;
  let hi = seqs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((seqs[mid] as number) < seq) lo = mid + 1;
    else hi = mid;
  }
  if (seqs[lo] === seq) return seqs;
  return [...seqs.slice(0, lo), seq, ...seqs.slice(lo)];
}

/**
 * Merges server messages: dedupes by seq and client_id, and removes the optimistic local copy
 * whose client_id matches (ack reconciliation). Returns the same object when nothing changed.
 */
export function mergeServerMessages(
  current: ConversationMessages,
  messages: readonly Message[],
): ConversationMessages {
  let bySeq = current.bySeq;
  let seqs = current.seqs;
  let seqByClientId = current.seqByClientId;
  let local = current.local;
  let changed = false;
  let copied = false;

  for (const message of messages) {
    if (local.some((l) => l.client_id === message.client_id)) {
      local = local.filter((l) => l.client_id !== message.client_id);
      changed = true;
    }
    const existing = bySeq[message.seq];
    if (existing && existing.id === message.id) continue;
    const knownSeq = seqByClientId[message.client_id];
    if (!existing && knownSeq !== undefined && bySeq[knownSeq]?.sender_id === message.sender_id) {
      // (sender, client_id) is unique server-side, so this is a duplicate delivery.
      continue;
    }
    if (!copied) {
      bySeq = { ...bySeq };
      seqByClientId = { ...seqByClientId };
      copied = true;
    }
    bySeq[message.seq] = message;
    seqByClientId[message.client_id] = message.seq;
    seqs = insertSorted(seqs, message.seq);
    changed = true;
  }

  if (!changed) return current;
  return { ...current, bySeq, seqs, seqByClientId, local };
}

export function addLocalMessage(
  current: ConversationMessages,
  local: LocalMessage,
): ConversationMessages {
  if (current.seqByClientId[local.client_id] !== undefined) return current; // already acked
  if (current.local.some((l) => l.client_id === local.client_id)) return current;
  return { ...current, local: [...current.local, local] };
}

export function setLocalState(
  current: ConversationMessages,
  clientId: string,
  state: LocalMessage['state'],
): ConversationMessages {
  const idx = current.local.findIndex((l) => l.client_id === clientId);
  const target = current.local[idx];
  if (!target || target.state === state) return current;
  const local = [...current.local];
  local[idx] = { ...target, state };
  return { ...current, local };
}

export function removeLocalMessage(
  current: ConversationMessages,
  clientId: string,
): ConversationMessages {
  if (!current.local.some((l) => l.client_id === clientId)) return current;
  return { ...current, local: current.local.filter((l) => l.client_id !== clientId) };
}

export function maxSeq(current: ConversationMessages | undefined): number {
  return current?.seqs[current.seqs.length - 1] ?? 0;
}

/**
 * The highest seq such that every seq from the oldest loaded one up to it is present.
 * Sync with `after_seq` must start here, not at the max, so holes are filled.
 */
export function contiguousMaxSeq(current: ConversationMessages | undefined): number {
  if (!current || current.seqs.length === 0) return 0;
  const seqs = current.seqs;
  let prev = seqs[0] as number;
  for (let i = 1; i < seqs.length; i++) {
    const s = seqs[i] as number;
    if (s !== prev + 1) return prev;
    prev = s;
  }
  return prev;
}

/** True when the loaded window has a hole, or `incomingSeq` would create one. */
export function hasGap(current: ConversationMessages | undefined, incomingSeq?: number): boolean {
  if (!current || current.seqs.length === 0) return false;
  const top = contiguousMaxSeq(current);
  if (top !== maxSeq(current)) return true;
  return incomingSeq !== undefined && incomingSeq > top + 1;
}

/** Drops everything but the newest `keep` server messages (used for the persisted cache). */
export function trimToNewest(current: ConversationMessages, keep: number): ConversationMessages {
  if (current.seqs.length <= keep) return current;
  const seqs = current.seqs.slice(-keep);
  const bySeq: Record<number, Message> = {};
  const seqByClientId: Record<string, number> = {};
  for (const s of seqs) {
    const m = current.bySeq[s];
    if (m) {
      bySeq[s] = m;
      seqByClientId[m.client_id] = s;
    }
  }
  return { ...current, seqs, bySeq, seqByClientId, hasMoreOlder: true };
}

/** PROTOCOL §2 derived status — never stored per message. */
export function deriveStatus(
  message: Message | LocalMessage,
  conversation: Pick<Conversation, 'peer_delivered_seq' | 'peer_read_seq'> | undefined,
): MessageStatus {
  if (!('seq' in message)) return message.state;
  if (conversation && message.seq <= conversation.peer_read_seq) return 'read';
  if (conversation && message.seq <= conversation.peer_delivered_seq) return 'delivered';
  return 'sent';
}

export function isLocalMessage(message: Message | LocalMessage): message is LocalMessage {
  return !('seq' in message);
}
