import { conversationsApi } from '@/services/api/endpoints';
import { telemetry } from '@/services/telemetry';
import { wsClient } from '@/services/websocket';
import { getMyUserId } from '@/store/authStore';
import { useConversationsStore } from '@/store/conversationsStore';
import { getConversationMessages } from '@/store/messagesStore';

/**
 * Delivered / read watermarks we've already reported, per conversation. Watermarks only move
 * forward (PROTOCOL §2), so re-sending a lower value is pointless.
 */
const deliveredSent = new Map<string, number>();
const readSent = new Map<string, number>();

export function resetReceiptState(): void {
  deliveredSent.clear();
  readSent.clear();
}

/** Highest seq from the peer that this device holds for the conversation. */
function highestPeerSeq(conversationId: string): number {
  const me = getMyUserId();
  const conv = useConversationsStore.getState().byId[conversationId];
  let best = 0;
  if (conv?.last_message && conv.last_message.sender_id !== me) best = conv.last_message.seq;
  const loaded = getConversationMessages(conversationId);
  if (loaded) {
    for (let i = loaded.seqs.length - 1; i >= 0; i--) {
      const m = loaded.bySeq[loaded.seqs[i] as number];
      if (m && m.sender_id !== me) {
        best = Math.max(best, m.seq);
        break;
      }
    }
  }
  return best;
}

/** `message.delivered` for everything from the peer this device has received. */
export function reportDelivered(
  conversationId: string,
  seq = highestPeerSeq(conversationId),
): void {
  if (seq <= 0) return;
  if (seq <= (deliveredSent.get(conversationId) ?? 0) || seq <= (readSent.get(conversationId) ?? 0))
    return;
  if (wsClient().send('message.delivered', { conversation_id: conversationId, seq })) {
    deliveredSent.set(conversationId, seq);
  }
}

/** Delivered receipts for every conversation whose newest message is from the peer (after resync). */
export function reportDeliveredForAll(): void {
  for (const id of Object.keys(useConversationsStore.getState().byId)) reportDelivered(id);
}

/**
 * `message.read` (implies delivered). Called only when the messages are on screen and the app
 * is active. Falls back to REST when the socket is down.
 */
export function reportRead(conversationId: string, seq: number): void {
  if (seq <= 0 || seq <= (readSent.get(conversationId) ?? 0)) return;
  readSent.set(conversationId, seq);
  useConversationsStore.getState().markReadLocally(conversationId, seq);
  if (wsClient().send('message.read', { conversation_id: conversationId, seq })) return;
  conversationsApi
    .markRead(conversationId, seq)
    .then((res) =>
      useConversationsStore
        .getState()
        .setUnreadCount(conversationId, res.unread_count, res.read_seq),
    )
    .catch((error: unknown) => {
      // Allow a later attempt to re-send this watermark.
      if ((readSent.get(conversationId) ?? 0) === seq) readSent.delete(conversationId);
      telemetry.warn('receipts', 'read receipt failed', { error: String(error) });
    });
}
