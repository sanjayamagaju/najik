import { randomUUID } from 'node:crypto';
import { db } from './index.js';

export type MessageKind = 'text' | 'ping' | 'call';

export interface CallMeta {
  media: 'audio' | 'video';
  outcome: 'completed' | 'missed' | 'declined' | 'cancelled' | 'failed';
  durationSec: number;
}

interface MessageRow {
  id: string;
  client_id: string | null;
  sender_id: string;
  recipient_id: string;
  kind: MessageKind;
  body: string;
  meta: string | null;
  created_at: number;
  delivered_at: number | null;
  read_at: number | null;
}

export interface MessageDTO {
  id: string;
  clientId: string | null;
  senderId: string;
  recipientId: string;
  kind: MessageKind;
  body: string;
  meta: CallMeta | null;
  createdAt: number;
  deliveredAt: number | null;
  readAt: number | null;
}

export interface ConversationDTO {
  peerId: string;
  lastMessage: MessageDTO;
  unread: number;
}

function toDTO(row: MessageRow): MessageDTO {
  return {
    id: row.id,
    clientId: row.client_id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    kind: row.kind,
    body: row.body,
    meta: row.meta ? (JSON.parse(row.meta) as CallMeta) : null,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
  };
}

const stmts = {
  insert: db.prepare(
    `INSERT INTO messages (id, client_id, sender_id, recipient_id, kind, body, meta, created_at, delivered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  byId: db.prepare('SELECT * FROM messages WHERE id = ?'),
  byClientId: db.prepare('SELECT * FROM messages WHERE sender_id = ? AND client_id = ?'),
  // Keyset pagination on (created_at, id) so messages sharing a millisecond are never skipped.
  history: db.prepare(
    `SELECT * FROM messages
     WHERE ((sender_id = $me AND recipient_id = $peer) OR (sender_id = $peer AND recipient_id = $me))
       AND (created_at < $before OR (created_at = $before AND id < $beforeId))
     ORDER BY created_at DESC, id DESC
     LIMIT $limit`,
  ),
  conversations: db.prepare(
    `WITH mine AS (
       SELECT m.*, CASE WHEN m.sender_id = $me THEN m.recipient_id ELSE m.sender_id END AS peer_id
       FROM messages m
       WHERE m.sender_id = $me OR m.recipient_id = $me
     ),
     ranked AS (
       SELECT mine.*, ROW_NUMBER() OVER (PARTITION BY peer_id ORDER BY created_at DESC) AS rn
       FROM mine
     )
     SELECT r.*,
       (SELECT COUNT(*) FROM messages u
         WHERE u.sender_id = r.peer_id AND u.recipient_id = $me AND u.read_at IS NULL) AS unread
     FROM ranked r
     WHERE r.rn = 1
     ORDER BY r.created_at DESC`,
  ),
  markDeliveredAll: db.prepare(
    `UPDATE messages SET delivered_at = ?
     WHERE recipient_id = ? AND delivered_at IS NULL
     RETURNING id, sender_id`,
  ),
  markDelivered: db.prepare(
    `UPDATE messages SET delivered_at = ?
     WHERE id = ? AND recipient_id = ? AND delivered_at IS NULL
     RETURNING id, sender_id`,
  ),
  markRead: db.prepare(
    `UPDATE messages SET read_at = $now, delivered_at = COALESCE(delivered_at, $now)
     WHERE recipient_id = $me AND sender_id = $peer AND read_at IS NULL
     RETURNING id`,
  ),
  peersOf: db.prepare(
    `SELECT DISTINCT CASE WHEN sender_id = $me THEN recipient_id ELSE sender_id END AS peer_id
     FROM messages WHERE sender_id = $me OR recipient_id = $me`,
  ),
};

export const messages = {
  create(input: {
    senderId: string;
    recipientId: string;
    kind: MessageKind;
    body?: string;
    meta?: CallMeta | null;
    clientId?: string | null;
    delivered?: boolean;
  }): { message: MessageDTO; duplicate: boolean } {
    if (input.clientId) {
      // Idempotent send: a retried message with the same client id returns the original.
      const existing = stmts.byClientId.get(input.senderId, input.clientId) as unknown as MessageRow | undefined;
      if (existing) return { message: toDTO(existing), duplicate: true };
    }
    const id = randomUUID();
    const now = Date.now();
    stmts.insert.run(
      id,
      input.clientId ?? null,
      input.senderId,
      input.recipientId,
      input.kind,
      input.body ?? '',
      input.meta ? JSON.stringify(input.meta) : null,
      now,
      input.delivered ? now : null,
    );
    return { message: toDTO(stmts.byId.get(id) as unknown as MessageRow), duplicate: false };
  },

  history(me: string, peer: string, before: number, beforeId: string, limit: number): MessageDTO[] {
    const rows = stmts.history.all({ me, peer, before, beforeId, limit }) as unknown as MessageRow[];
    return rows.reverse().map(toDTO);
  },

  conversations(me: string): ConversationDTO[] {
    const rows = stmts.conversations.all({ me }) as unknown as (MessageRow & { peer_id: string; unread: number })[];
    return rows.map((r) => ({ peerId: r.peer_id, lastMessage: toDTO(r), unread: Number(r.unread) }));
  },

  /** Marks everything addressed to `me` as delivered. Returns ids grouped by sender. */
  markAllDelivered(me: string, at = Date.now()): Map<string, string[]> {
    const rows = stmts.markDeliveredAll.all(at, me) as unknown as { id: string; sender_id: string }[];
    return groupBySender(rows);
  },

  markDelivered(me: string, ids: string[], at = Date.now()): Map<string, string[]> {
    const rows: { id: string; sender_id: string }[] = [];
    for (const id of ids) {
      const row = stmts.markDelivered.get(at, id, me) as unknown as { id: string; sender_id: string } | undefined;
      if (row) rows.push(row);
    }
    return groupBySender(rows);
  },

  /** Marks every message from `peer` to `me` as read. Returns affected ids. */
  markRead(me: string, peer: string, at = Date.now()): string[] {
    const rows = stmts.markRead.all({ now: at, me, peer }) as unknown as { id: string }[];
    return rows.map((r) => r.id);
  },

  peersOf(me: string): string[] {
    return (stmts.peersOf.all({ me }) as unknown as { peer_id: string }[]).map((r) => r.peer_id);
  },
};

function groupBySender(rows: { id: string; sender_id: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const list = out.get(r.sender_id) ?? [];
    list.push(r.id);
    out.set(r.sender_id, list);
  }
  return out;
}
