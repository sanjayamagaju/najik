import type { Conversation, Me, Message, PublicUser } from '@/types/protocol';

/** Lightweight runtime validators for data read back from local caches. */

type Obj = Record<string, unknown>;

export const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isPublicUser(v: unknown): v is PublicUser {
  return (
    isObject(v) &&
    isStr(v.id) &&
    isStr(v.username) &&
    isStr(v.display_name) &&
    isStr(v.avatar_color) &&
    isStr(v.created_at)
  );
}

export function isMe(v: unknown): v is Me {
  return isPublicUser(v) && (v as unknown as Obj).email !== undefined;
}

export function isMessage(v: unknown): v is Message {
  return (
    isObject(v) &&
    isStr(v.id) &&
    isStr(v.client_id) &&
    isStr(v.conversation_id) &&
    isStr(v.sender_id) &&
    isNum(v.seq) &&
    (v.kind === 'text' || v.kind === 'ping' || v.kind === 'call') &&
    isStr(v.body) &&
    isStr(v.created_at)
  );
}

export function isConversation(v: unknown): v is Conversation {
  return (
    isObject(v) &&
    isStr(v.id) &&
    isPublicUser(v.peer) &&
    (v.last_message === null || isMessage(v.last_message)) &&
    isNum(v.last_seq) &&
    isNum(v.unread_count) &&
    isNum(v.my_read_seq) &&
    isNum(v.peer_delivered_seq) &&
    isNum(v.peer_read_seq) &&
    isStr(v.updated_at)
  );
}

/** Keeps only valid items of an array; returns null if the input isn't an array. */
export function filterValid<T>(v: unknown, guard: (x: unknown) => x is T): T[] | null {
  return Array.isArray(v) ? v.filter(guard) : null;
}
