import type { ConversationMessages, LocalMessage } from '@/store/messagesModel';
import type { Message } from '@/types/protocol';
import { dayKey } from '@/utils/date';

/** Consecutive messages from the same sender within this window are visually grouped. */
export const GROUP_WINDOW_MS = 3 * 60_000;

export type GroupPosition = 'single' | 'first' | 'middle' | 'last';

export interface MessageItem {
  type: 'message';
  key: string;
  message: Message | LocalMessage;
  isMine: boolean;
  /** Position within a visual group, top → bottom. The tail/timestamp go on `last`/`single`. */
  position: GroupPosition;
}

export interface DayItem {
  type: 'day';
  key: string;
  /** ISO timestamp of the first message of that day (label is formatted at render time). */
  at: string;
}

export type ThreadItem = MessageItem | DayItem;

function groupable(m: Message | LocalMessage): boolean {
  return m.kind === 'text';
}

function canJoin(a: Message | LocalMessage, b: Message | LocalMessage): boolean {
  return (
    a.sender_id === b.sender_id &&
    groupable(a) &&
    groupable(b) &&
    dayKey(a.created_at) === dayKey(b.created_at) &&
    Math.abs(Date.parse(b.created_at) - Date.parse(a.created_at)) <= GROUP_WINDOW_MS
  );
}

/**
 * Builds render items for an inverted list: index 0 is the newest message. Server messages
 * come first in seq order, followed by optimistic local ones (which always sort last until
 * acknowledged). Stable keys use client_id so an optimistic bubble keeps its identity (and
 * doesn't re-animate) when the ack swaps in the server copy.
 */
export function buildThreadItems(
  conv: ConversationMessages | undefined,
  myUserId: string | null,
): ThreadItem[] {
  if (!conv) return [];
  const ordered: (Message | LocalMessage)[] = [];
  for (const seq of conv.seqs) {
    const m = conv.bySeq[seq];
    if (m) ordered.push(m);
  }
  for (const l of conv.local) ordered.push(l);

  const items: ThreadItem[] = [];
  // Walk newest → oldest, emitting a day separator after the oldest message of each day.
  for (let i = ordered.length - 1; i >= 0; i--) {
    const m = ordered[i] as Message | LocalMessage;
    const newer = ordered[i + 1];
    const older = ordered[i - 1];
    const joinsOlder = older !== undefined && canJoin(older, m);
    const joinsNewer = newer !== undefined && canJoin(m, newer);
    const position: GroupPosition =
      joinsOlder && joinsNewer ? 'middle' : joinsOlder ? 'last' : joinsNewer ? 'first' : 'single';
    items.push({
      type: 'message',
      key: m.client_id,
      message: m,
      isMine: m.sender_id === myUserId,
      position,
    });
    if (!older || dayKey(older.created_at) !== dayKey(m.created_at)) {
      items.push({ type: 'day', key: `day-${dayKey(m.created_at)}`, at: m.created_at });
    }
  }
  return items;
}
