import { create } from 'zustand';

import type { Conversation, Message } from '@/types/protocol';

interface ConversationsState {
  byId: Record<string, Conversation>;
  /** True once the first page was fetched from the server this session. */
  loaded: boolean;
  nextCursor: string | null;
  hydrate: (conversations: Conversation[]) => void;
  /** Replace with a fresh first page while keeping conversations from later pages. */
  upsertMany: (
    conversations: Conversation[],
    meta?: { nextCursor?: string | null; firstPage?: boolean },
  ) => void;
  upsert: (conversation: Conversation) => void;
  applyMessage: (message: Message, opts: { myUserId: string; countAsUnread: boolean }) => void;
  applyReceipt: (
    receipt: {
      conversation_id: string;
      user_id: string;
      delivered_seq: number;
      read_seq: number;
    },
    myUserId: string,
  ) => void;
  markReadLocally: (conversationId: string, seq: number) => void;
  /** Authoritative unread count from POST /conversations/{id}/read. */
  setUnreadCount: (conversationId: string, unread: number, readSeq: number) => void;
  reset: () => void;
}

const later = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b);

/**
 * Server values win for fields that only the server knows, but watermarks never move
 * backwards (PROTOCOL §2) — a stale REST page must not undo a fresher WS receipt.
 */
export function mergeConversation(
  prev: Conversation | undefined,
  next: Conversation,
): Conversation {
  if (!prev) return next;
  const lastFromPrev = prev.last_seq > next.last_seq;
  return {
    ...next,
    last_seq: Math.max(prev.last_seq, next.last_seq),
    last_message: lastFromPrev ? prev.last_message : next.last_message,
    updated_at: later(prev.updated_at, next.updated_at),
    my_read_seq: Math.max(prev.my_read_seq, next.my_read_seq),
    peer_delivered_seq: Math.max(prev.peer_delivered_seq, next.peer_delivered_seq),
    peer_read_seq: Math.max(prev.peer_read_seq, next.peer_read_seq),
    unread_count: lastFromPrev ? prev.unread_count : next.unread_count,
  };
}

export const useConversationsStore = create<ConversationsState>()((set) => ({
  byId: {},
  loaded: false,
  nextCursor: null,
  hydrate: (conversations) =>
    set({ byId: Object.fromEntries(conversations.map((c) => [c.id, c])) }),
  upsertMany: (conversations, meta) =>
    set((state) => {
      const byId = { ...state.byId };
      for (const c of conversations) byId[c.id] = mergeConversation(byId[c.id], c);
      return {
        byId,
        loaded: state.loaded || meta?.firstPage === true,
        nextCursor: meta?.nextCursor !== undefined ? meta.nextCursor : state.nextCursor,
      };
    }),
  upsert: (conversation) =>
    set((state) => ({
      byId: {
        ...state.byId,
        [conversation.id]: mergeConversation(state.byId[conversation.id], conversation),
      },
    })),
  applyMessage: (message, { myUserId, countAsUnread }) =>
    set((state) => {
      const conv = state.byId[message.conversation_id];
      if (!conv) return state;
      if (message.seq <= conv.last_seq && conv.last_message?.seq === message.seq) return state;
      const isNewer = message.seq > conv.last_seq;
      const fromPeer = message.sender_id !== myUserId;
      const next: Conversation = {
        ...conv,
        last_seq: Math.max(conv.last_seq, message.seq),
        last_message: isNewer || !conv.last_message ? message : conv.last_message,
        updated_at: isNewer ? later(conv.updated_at, message.created_at) : conv.updated_at,
        unread_count:
          isNewer && fromPeer && countAsUnread && message.seq > conv.my_read_seq
            ? conv.unread_count + 1
            : conv.unread_count,
        // My own message is implicitly read by me.
        my_read_seq: !fromPeer ? Math.max(conv.my_read_seq, message.seq) : conv.my_read_seq,
      };
      return { byId: { ...state.byId, [conv.id]: next } };
    }),
  applyReceipt: (receipt, myUserId) =>
    set((state) => {
      const conv = state.byId[receipt.conversation_id];
      if (!conv) return state;
      let next: Conversation;
      if (receipt.user_id === myUserId) {
        // One of my other devices read the chat.
        const myRead = Math.max(conv.my_read_seq, receipt.read_seq);
        next = {
          ...conv,
          my_read_seq: myRead,
          unread_count: myRead >= conv.last_seq ? 0 : conv.unread_count,
        };
      } else {
        next = {
          ...conv,
          peer_delivered_seq: Math.max(
            conv.peer_delivered_seq,
            receipt.delivered_seq,
            receipt.read_seq,
          ),
          peer_read_seq: Math.max(conv.peer_read_seq, receipt.read_seq),
        };
      }
      if (
        next.my_read_seq === conv.my_read_seq &&
        next.unread_count === conv.unread_count &&
        next.peer_delivered_seq === conv.peer_delivered_seq &&
        next.peer_read_seq === conv.peer_read_seq
      ) {
        return state;
      }
      return { byId: { ...state.byId, [conv.id]: next } };
    }),
  markReadLocally: (conversationId, seq) =>
    set((state) => {
      const conv = state.byId[conversationId];
      if (!conv || (seq <= conv.my_read_seq && conv.unread_count === 0)) return state;
      const myRead = Math.max(conv.my_read_seq, seq);
      return {
        byId: {
          ...state.byId,
          [conversationId]: {
            ...conv,
            my_read_seq: myRead,
            unread_count: myRead >= conv.last_seq ? 0 : conv.unread_count,
          },
        },
      };
    }),
  setUnreadCount: (conversationId, unread, readSeq) =>
    set((state) => {
      const conv = state.byId[conversationId];
      if (!conv) return state;
      return {
        byId: {
          ...state.byId,
          [conversationId]: {
            ...conv,
            unread_count: unread,
            my_read_seq: Math.max(conv.my_read_seq, readSeq),
          },
        },
      };
    }),
  reset: () => set({ byId: {}, loaded: false, nextCursor: null }),
}));

/** Conversation ids sorted by updated_at desc (use with useShallow). */
export function selectSortedConversationIds(state: Pick<ConversationsState, 'byId'>): string[] {
  return Object.values(state.byId)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .map((c) => c.id);
}

export function selectTotalUnread(state: Pick<ConversationsState, 'byId'>): number {
  let total = 0;
  for (const c of Object.values(state.byId)) total += c.unread_count;
  return total;
}
