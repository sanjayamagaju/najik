import { create } from 'zustand';

/** PROTOCOL §4.3: the client auto-expires a `typing:start` after 6 s. */
export const TYPING_EXPIRY_MS = 6_000;

interface TypingState {
  /** conversationId → true while the peer is typing. */
  byConversation: Record<string, true>;
  apply: (conversationId: string, state: 'start' | 'stop') => void;
  /** A message from the peer implicitly ends typing. */
  clear: (conversationId: string) => void;
  reset: () => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(conversationId: string) {
  const timer = timers.get(conversationId);
  if (timer) clearTimeout(timer);
  timers.delete(conversationId);
}

export const useTypingStore = create<TypingState>()((set, get) => ({
  byConversation: {},
  apply: (conversationId, state) => {
    if (state === 'stop') {
      get().clear(conversationId);
      return;
    }
    clearTimer(conversationId);
    timers.set(
      conversationId,
      setTimeout(() => get().clear(conversationId), TYPING_EXPIRY_MS),
    );
    if (!get().byConversation[conversationId]) {
      set((s) => ({ byConversation: { ...s.byConversation, [conversationId]: true } }));
    }
  },
  clear: (conversationId) => {
    clearTimer(conversationId);
    if (!get().byConversation[conversationId]) return;
    set((s) => {
      const byConversation = { ...s.byConversation };
      delete byConversation[conversationId];
      return { byConversation };
    });
  },
  reset: () => {
    for (const id of [...timers.keys()]) clearTimer(id);
    set({ byConversation: {} });
  },
}));
