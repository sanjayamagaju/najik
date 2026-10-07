import { conversationsApi } from '@/services/api/endpoints';
import { telemetry } from '@/services/telemetry';
import { getMyUserId } from '@/store/authStore';
import { useConversationsStore } from '@/store/conversationsStore';
import { hasGap } from '@/store/messagesModel';
import { getConversationMessages, useMessagesStore } from '@/store/messagesStore';
import { useTypingStore } from '@/store/typingStore';
import { useUiStore } from '@/store/uiStore';
import type { Message } from '@/types/protocol';

import { syncForward } from './history';

const fetchingConversations = new Set<string>();

/** Fetches a conversation we don't know yet (first message from a new contact). */
async function ensureConversation(conversationId: string): Promise<void> {
  if (
    useConversationsStore.getState().byId[conversationId] ||
    fetchingConversations.has(conversationId)
  )
    return;
  fetchingConversations.add(conversationId);
  try {
    const conversation = await conversationsApi.get(conversationId);
    useConversationsStore.getState().upsert(conversation);
  } catch (error) {
    telemetry.warn('ingest', 'conversation fetch failed', { error: String(error) });
  } finally {
    fetchingConversations.delete(conversationId);
  }
}

export function isConversationOnScreen(conversationId: string): boolean {
  const ui = useUiStore.getState();
  return ui.appActive && ui.activeConversationId === conversationId;
}

/**
 * Single entry point for any server message (ack, `message.new`, `ping.received`).
 * Dedupes, reconciles optimistic copies, updates the chat list, and triggers a forward sync
 * when a seq gap is detected.
 */
export function ingestMessage(message: Message): { fromPeer: boolean } {
  const myUserId = getMyUserId();
  const conversationId = message.conversation_id;
  const fromPeer = message.sender_id !== myUserId;

  const before = getConversationMessages(conversationId);
  const gap = hasGap(before, message.seq);
  useMessagesStore.getState().upsertMessages(conversationId, [message]);
  if (gap) {
    syncForward(conversationId).catch((error: unknown) =>
      telemetry.warn('ingest', 'gap sync failed', { error: String(error) }),
    );
  }

  if (myUserId) {
    useConversationsStore.getState().applyMessage(message, {
      myUserId,
      countAsUnread: !isConversationOnScreen(conversationId),
    });
  }
  if (!useConversationsStore.getState().byId[conversationId])
    void ensureConversation(conversationId);
  if (fromPeer) useTypingStore.getState().clear(conversationId);
  return { fromPeer };
}
