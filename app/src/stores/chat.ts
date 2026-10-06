import { create } from 'zustand';
import { api } from '../lib/api';
import { emit, emitAck } from '../lib/socket';
import { clientId } from '../lib/utils';
import type { Conversation, DeliveryStatus, Message, User } from '../types';

interface Thread {
  messages: Message[];
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
}

interface ConversationEntry {
  peerId: string;
  lastMessage: Message;
  unread: number;
}

interface ChatState {
  meId: string | null;
  users: Record<string, User>;
  conversations: Record<string, ConversationEntry>;
  conversationsLoaded: boolean;
  threads: Record<string, Thread>;
  typing: Record<string, boolean>;
  activePeerId: string | null;
  /** Last received ping, drives the full-screen ping animation. */
  incomingPing: { from: string; at: number } | null;

  init: (meId: string) => void;
  reset: () => void;
  loadConversations: () => Promise<void>;
  ensureUser: (userId: string) => Promise<User | null>;
  upsertUser: (user: User) => void;
  setActivePeer: (peerId: string | null) => void;
  loadThread: (peerId: string) => Promise<void>;
  /** After a reconnect: threads may have missed messages, so allow reloading them. */
  invalidateThreads: () => void;
  loadOlder: (peerId: string) => Promise<void>;
  sendText: (peerId: string, body: string) => Promise<void>;
  retry: (peerId: string, message: Message) => Promise<void>;
  sendPing: (peerId: string) => Promise<void>;
  receive: (message: Message) => void;
  applyStatus: (ids: string[], status: 'delivered' | 'read', at: number) => void;
  markRead: (peerId: string) => void;
  clearUnread: (peerId: string) => void;
  setPresence: (userId: string, online: boolean, lastSeen: number | null) => void;
  setTyping: (peerId: string, typing: boolean) => void;
  clearPing: () => void;
}

const emptyThread = (): Thread => ({ messages: [], hasMore: false, loading: false, loaded: false });

/** Insert or replace (by id or clientId), keeping chronological order. */
function upsertMessage(list: Message[], msg: Message): Message[] {
  const idx = list.findIndex((m) => m.id === msg.id || (msg.clientId && m.clientId === msg.clientId));
  if (idx >= 0) {
    const next = list.slice();
    next[idx] = { ...list[idx], ...msg, pending: msg.pending ?? false, failed: msg.failed ?? false };
    return next;
  }
  const next = [...list, msg];
  for (let i = next.length - 1; i > 0 && next[i].createdAt < next[i - 1].createdAt; i--) {
    [next[i], next[i - 1]] = [next[i - 1], next[i]];
  }
  return next;
}

export function statusOf(m: Message): DeliveryStatus {
  if (m.failed) return 'failed';
  if (m.pending) return 'sending';
  if (m.readAt) return 'read';
  if (m.deliveredAt) return 'delivered';
  return 'sent';
}

const inflightUsers = new Map<string, Promise<User | null>>();

export const useChat = create<ChatState>((set, get) => {
  const peerOf = (m: Message) => (m.senderId === get().meId ? m.recipientId : m.senderId);

  const putMessage = (m: Message) => {
    const peerId = peerOf(m);
    const s = get();
    const thread = s.threads[peerId] ?? emptyThread();
    const conv = s.conversations[peerId];
    const isNewer = !conv || m.createdAt >= conv.lastMessage.createdAt || conv.lastMessage.clientId === m.clientId;
    set({
      threads: { ...s.threads, [peerId]: { ...thread, messages: upsertMessage(thread.messages, m) } },
      conversations: isNewer
        ? { ...s.conversations, [peerId]: { peerId, lastMessage: m, unread: conv?.unread ?? 0 } }
        : s.conversations,
    });
  };

  const sendOptimistic = async (optimistic: Message, event: string, payload: object) => {
    putMessage(optimistic);
    try {
      const res = await emitAck<{ message: Message }>(event, payload);
      putMessage({ ...res.message, pending: false, failed: false });
    } catch (err) {
      putMessage({ ...optimistic, pending: false, failed: true });
      throw err;
    }
  };

  return {
    meId: null,
    users: {},
    conversations: {},
    conversationsLoaded: false,
    threads: {},
    typing: {},
    activePeerId: null,
    incomingPing: null,

    init(meId) {
      set({ meId });
    },

    reset() {
      set({
        meId: null,
        users: {},
        conversations: {},
        conversationsLoaded: false,
        threads: {},
        typing: {},
        activePeerId: null,
        incomingPing: null,
      });
    },

    async loadConversations() {
      const { conversations } = await api<{ conversations: Conversation[] }>('/messages/conversations');
      const users = { ...get().users };
      const map: Record<string, ConversationEntry> = {};
      for (const c of conversations) {
        users[c.peerId] = { ...users[c.peerId], ...c.peer };
        map[c.peerId] = { peerId: c.peerId, lastMessage: c.lastMessage, unread: c.unread };
      }
      // Keep optimistic entries that the server doesn't know about yet.
      for (const [id, entry] of Object.entries(get().conversations)) {
        if (!map[id] || entry.lastMessage.createdAt > map[id].lastMessage.createdAt) map[id] = { ...entry, unread: map[id]?.unread ?? entry.unread };
      }
      set({ users, conversations: map, conversationsLoaded: true });
    },

    ensureUser(userId) {
      const known = get().users[userId];
      if (known) return Promise.resolve(known);
      let p = inflightUsers.get(userId);
      if (!p) {
        p = api<{ user: User }>(`/users/${userId}`)
          .then(({ user }) => {
            get().upsertUser(user);
            return user;
          })
          .catch(() => null)
          .finally(() => inflightUsers.delete(userId));
        inflightUsers.set(userId, p);
      }
      return p;
    },

    upsertUser(user) {
      set({ users: { ...get().users, [user.id]: { ...get().users[user.id], ...user } } });
    },

    setActivePeer(peerId) {
      set({ activePeerId: peerId });
      if (peerId) get().markRead(peerId);
    },

    async loadThread(peerId) {
      const existing = get().threads[peerId];
      if (existing?.loaded || existing?.loading) return;
      set({ threads: { ...get().threads, [peerId]: { ...(existing ?? emptyThread()), loading: true } } });
      try {
        const res = await api<{ messages: Message[]; hasMore: boolean }>(`/messages/with/${peerId}?limit=40`);
        const current = get().threads[peerId] ?? emptyThread();
        let merged = res.messages;
        for (const m of current.messages) merged = upsertMessage(merged, m);
        set({
          threads: { ...get().threads, [peerId]: { messages: merged, hasMore: res.hasMore, loading: false, loaded: true } },
        });
      } catch (err) {
        set({ threads: { ...get().threads, [peerId]: { ...(get().threads[peerId] ?? emptyThread()), loading: false } } });
        throw err;
      }
    },

    invalidateThreads() {
      const threads: Record<string, Thread> = {};
      for (const [id, t] of Object.entries(get().threads)) threads[id] = { ...t, loaded: false };
      set({ threads });
    },

    async loadOlder(peerId) {
      const thread = get().threads[peerId];
      if (!thread || thread.loading || !thread.hasMore || thread.messages.length === 0) return;
      set({ threads: { ...get().threads, [peerId]: { ...thread, loading: true } } });
      try {
        const oldest = thread.messages.find((m) => !m.pending && !m.failed) ?? thread.messages[0];
        const res = await api<{ messages: Message[]; hasMore: boolean }>(
          `/messages/with/${peerId}?limit=40&before=${oldest.createdAt}&beforeId=${encodeURIComponent(oldest.id)}`,
        );
        const t = get().threads[peerId];
        set({
          threads: {
            ...get().threads,
            [peerId]: { ...t, messages: [...res.messages, ...t.messages], hasMore: res.hasMore, loading: false },
          },
        });
      } catch {
        set({ threads: { ...get().threads, [peerId]: { ...get().threads[peerId], loading: false } } });
      }
    },

    async sendText(peerId, body) {
      const meId = get().meId!;
      const cid = clientId();
      const optimistic: Message = {
        id: `local-${cid}`,
        clientId: cid,
        senderId: meId,
        recipientId: peerId,
        kind: 'text',
        body,
        meta: null,
        createdAt: Date.now(),
        deliveredAt: null,
        readAt: null,
        pending: true,
      };
      await sendOptimistic(optimistic, 'message:send', { to: peerId, body, clientId: cid });
    },

    async retry(peerId, message) {
      if (!message.clientId) return;
      await sendOptimistic({ ...message, pending: true, failed: false }, 'message:send', {
        to: peerId,
        body: message.body,
        clientId: message.clientId,
      });
    },

    async sendPing(peerId) {
      const cid = clientId();
      const res = await emitAck<{ message: Message }>('ping:send', { to: peerId, clientId: cid });
      putMessage(res.message);
    },

    receive(m) {
      const s = get();
      const incoming = m.recipientId === s.meId;
      const peerId = peerOf(m);
      const known = s.threads[peerId]?.messages.some((x) => x.id === m.id);
      putMessage(m);
      if (!incoming || known) return;

      const typing = { ...get().typing, [peerId]: false };
      const viewing = s.activePeerId === peerId && document.visibilityState === 'visible';
      const conv = get().conversations[peerId];
      set({
        typing,
        conversations: { ...get().conversations, [peerId]: { ...conv, unread: viewing ? 0 : (conv?.unread ?? 0) + 1 } },
        incomingPing: m.kind === 'ping' ? { from: m.senderId, at: Date.now() } : s.incomingPing,
      });
      if (viewing) emit('message:read', { peerId });
      else emit('message:delivered', { ids: [m.id] });
      void get().ensureUser(peerId);
    },

    applyStatus(ids, status, at) {
      const idSet = new Set(ids);
      const patch = (m: Message): Message =>
        idSet.has(m.id)
          ? { ...m, deliveredAt: m.deliveredAt ?? at, readAt: status === 'read' ? (m.readAt ?? at) : m.readAt }
          : m;
      const threads = { ...get().threads };
      for (const [peerId, t] of Object.entries(threads)) {
        if (t.messages.some((m) => idSet.has(m.id))) threads[peerId] = { ...t, messages: t.messages.map(patch) };
      }
      const conversations = { ...get().conversations };
      for (const [peerId, c] of Object.entries(conversations)) {
        if (idSet.has(c.lastMessage.id)) conversations[peerId] = { ...c, lastMessage: patch(c.lastMessage) };
      }
      set({ threads, conversations });
    },

    markRead(peerId) {
      const conv = get().conversations[peerId];
      const thread = get().threads[peerId];
      const hasUnread = (conv?.unread ?? 0) > 0 || thread?.messages.some((m) => m.senderId === peerId && !m.readAt);
      if (!hasUnread) return;
      emit('message:read', { peerId });
      get().clearUnread(peerId);
    },

    clearUnread(peerId) {
      const conv = get().conversations[peerId];
      const thread = get().threads[peerId];
      const now = Date.now();
      set({
        conversations: conv ? { ...get().conversations, [peerId]: { ...conv, unread: 0 } } : get().conversations,
        threads: thread
          ? {
              ...get().threads,
              [peerId]: {
                ...thread,
                messages: thread.messages.map((m) => (m.senderId === peerId && !m.readAt ? { ...m, readAt: now } : m)),
              },
            }
          : get().threads,
      });
    },

    setPresence(userId, online, lastSeen) {
      const u = get().users[userId];
      if (!u) return;
      set({ users: { ...get().users, [userId]: { ...u, online, lastSeen: lastSeen ?? u.lastSeen } } });
    },

    setTyping(peerId, typing) {
      set({ typing: { ...get().typing, [peerId]: typing } });
    },

    clearPing() {
      set({ incomingPing: null });
    },
  };
});

export function sortedConversations(conversations: Record<string, ConversationEntry>): ConversationEntry[] {
  return Object.values(conversations).sort((a, b) => b.lastMessage.createdAt - a.lastMessage.createdAt);
}
