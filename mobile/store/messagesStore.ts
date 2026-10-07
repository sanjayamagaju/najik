import { create } from 'zustand';

import type { Message } from '@/types/protocol';

import {
  addLocalMessage,
  type ConversationMessages,
  emptyConversationMessages,
  type LocalMessage,
  mergeServerMessages,
  removeLocalMessage,
  setLocalState,
} from './messagesModel';

interface MessagesState {
  byConversation: Record<string, ConversationMessages>;
  hydrate: (byConversation: Record<string, ConversationMessages>) => void;
  /** Insert/merge server messages (history pages, sync pages, acks, message.new). */
  upsertMessages: (
    conversationId: string,
    messages: readonly Message[],
    meta?: { hasMoreOlder?: boolean },
  ) => void;
  addLocal: (local: LocalMessage) => void;
  setLocalState: (conversationId: string, clientId: string, state: LocalMessage['state']) => void;
  removeLocal: (conversationId: string, clientId: string) => void;
  /** Drops the loaded server window (keeps optimistic messages) before a fresh latest-page load. */
  resetWindow: (conversationId: string) => void;
  reset: () => void;
}

function update(
  state: MessagesState,
  conversationId: string,
  fn: (current: ConversationMessages) => ConversationMessages,
): Partial<MessagesState> | MessagesState {
  const current = state.byConversation[conversationId] ?? emptyConversationMessages();
  const next = fn(current);
  if (next === current && state.byConversation[conversationId]) return state;
  return { byConversation: { ...state.byConversation, [conversationId]: next } };
}

export const useMessagesStore = create<MessagesState>()((set) => ({
  byConversation: {},
  hydrate: (byConversation) => set({ byConversation }),
  upsertMessages: (conversationId, messages, meta) =>
    set((state) =>
      update(state, conversationId, (current) => {
        const merged = mergeServerMessages(current, messages);
        if (meta?.hasMoreOlder === undefined || merged.hasMoreOlder === meta.hasMoreOlder)
          return merged;
        return { ...merged, hasMoreOlder: meta.hasMoreOlder };
      }),
    ),
  addLocal: (local) =>
    set((state) => update(state, local.conversation_id, (c) => addLocalMessage(c, local))),
  setLocalState: (conversationId, clientId, localState) =>
    set((state) => update(state, conversationId, (c) => setLocalState(c, clientId, localState))),
  removeLocal: (conversationId, clientId) =>
    set((state) => update(state, conversationId, (c) => removeLocalMessage(c, clientId))),
  resetWindow: (conversationId) =>
    set((state) =>
      update(state, conversationId, (c) => ({
        ...emptyConversationMessages(),
        local: c.local,
      })),
    ),
  reset: () => set({ byConversation: {} }),
}));

export function getConversationMessages(conversationId: string): ConversationMessages | undefined {
  return useMessagesStore.getState().byConversation[conversationId];
}
