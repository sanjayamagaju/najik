import * as Crypto from 'expo-crypto';

import { conversationsApi } from '@/services/api/endpoints';
import { wsClient } from '@/services/websocket';
import { getMyUserId } from '@/store/authStore';
import { useConnectionStore } from '@/store/connectionStore';
import { useConversationsStore } from '@/store/conversationsStore';
import { useMessagesStore } from '@/store/messagesStore';
import { useOutboxStore } from '@/store/outboxStore';

import { ingestMessage } from './ingest';
import { createOutboxProcessor } from './outboxProcessor';

/** PROTOCOL §4.2: 1–4000 chars after trimming; control chars other than \n and \t are stripped. */
export const MAX_MESSAGE_LENGTH = 4000;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function normalizeOutgoingBody(input: string): string {
  return input.replace(CONTROL_CHARS, '').trim();
}

export const outbox = createOutboxProcessor({
  transport: {
    isOnline: () => useConnectionStore.getState().networkAvailable,
    isSocketOpen: () => wsClient().isOpen(),
    sendViaSocket: async (entry) => {
      const ack = await wsClient().request('message.send', {
        conversation_id: entry.conversation_id,
        client_id: entry.client_id,
        body: entry.body,
      });
      return ack.message;
    },
    sendViaRest: (entry) =>
      conversationsApi.sendMessage(entry.conversation_id, {
        client_id: entry.client_id,
        body: entry.body,
      }),
  },
  onAcked: (message) => {
    ingestMessage(message);
  },
  onFailed: (entry) => {
    useMessagesStore.getState().setLocalState(entry.conversation_id, entry.client_id, 'failed');
  },
  onRequeued: (entry) => {
    useMessagesStore.getState().setLocalState(entry.conversation_id, entry.client_id, 'sending');
  },
});

/**
 * Optimistic send: the message appears instantly (status `sending`), is persisted in the
 * outbox so it survives an app kill, and is delivered by the outbox processor.
 */
export function sendTextMessage(conversationId: string, rawBody: string): string | null {
  const body = normalizeOutgoingBody(rawBody);
  const senderId = getMyUserId();
  if (!body || body.length > MAX_MESSAGE_LENGTH || !senderId) return null;
  const clientId = Crypto.randomUUID();
  const createdAt = new Date().toISOString();
  useOutboxStore.getState().enqueue({
    client_id: clientId,
    conversation_id: conversationId,
    sender_id: senderId,
    body,
    created_at: createdAt,
  });
  useMessagesStore.getState().addLocal({
    client_id: clientId,
    conversation_id: conversationId,
    sender_id: senderId,
    kind: 'text',
    body,
    created_at: createdAt,
    state: 'sending',
  });
  // Bump the chat to the top immediately.
  const conv = useConversationsStore.getState().byId[conversationId];
  if (conv) useConversationsStore.getState().upsert({ ...conv, updated_at: createdAt });
  void outbox.flush();
  return clientId;
}

export function retryFailedMessage(clientId: string): void {
  void outbox.retry(clientId);
}

/** Discard a failed message the user no longer wants. */
export function discardFailedMessage(conversationId: string, clientId: string): void {
  useOutboxStore.getState().remove(clientId);
  useMessagesStore.getState().removeLocal(conversationId, clientId);
}
