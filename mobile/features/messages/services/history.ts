import { conversationsApi } from '@/services/api/endpoints';
import { telemetry } from '@/services/telemetry';
import { useConversationsStore } from '@/store/conversationsStore';
import { contiguousMaxSeq, maxSeq } from '@/store/messagesModel';
import { getConversationMessages, useMessagesStore } from '@/store/messagesStore';

import { reportDelivered } from './receipts';

const PAGE = 50;
const SYNC_PAGE = 100;
/** Beyond this many missing messages we drop the cached window and load the latest page instead. */
const MAX_FORWARD_SYNC = 300;

const inflight = new Map<string, Promise<void>>();

function singleFlight(key: string, fn: () => Promise<void>): Promise<void> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Latest page (no cursor). Used for a conversation we have nothing cached for. */
export function loadLatest(conversationId: string): Promise<void> {
  return singleFlight(`latest:${conversationId}`, async () => {
    const page = await conversationsApi.messages(conversationId, { limit: PAGE });
    useMessagesStore.getState().upsertMessages(conversationId, page.results, {
      hasMoreOlder: page.has_more,
    });
    reportDelivered(conversationId);
  });
}

/** Pages history backwards from the oldest loaded message (`before_seq`). */
export function loadOlder(conversationId: string): Promise<void> {
  return singleFlight(`older:${conversationId}`, async () => {
    const current = getConversationMessages(conversationId);
    const oldest = current?.seqs[0];
    if (!current || oldest === undefined || !current.hasMoreOlder) return;
    const page = await conversationsApi.messages(conversationId, {
      before_seq: oldest,
      limit: PAGE,
    });
    useMessagesStore.getState().upsertMessages(conversationId, page.results, {
      hasMoreOlder: page.has_more && (page.results[0]?.seq ?? 1) > 1,
    });
  });
}

/**
 * Forward sync (`after_seq`) from the top of the contiguous window until `has_more=false`.
 * Fills gaps detected from out-of-order `message.new` and catches up after reconnects.
 */
export function syncForward(conversationId: string): Promise<void> {
  return singleFlight(`sync:${conversationId}`, async () => {
    let from = contiguousMaxSeq(getConversationMessages(conversationId));
    if (from === 0) {
      await loadLatest(conversationId);
      return;
    }
    const target = useConversationsStore.getState().byId[conversationId]?.last_seq ?? 0;
    if (target - from > MAX_FORWARD_SYNC) {
      // Too far behind: start a fresh window at the latest page rather than paging thousands.
      useMessagesStore.getState().resetWindow(conversationId);
      await loadLatest(conversationId);
      return;
    }
    for (let guard = 0; guard < 50; guard++) {
      const page = await conversationsApi.messages(conversationId, {
        after_seq: from,
        limit: SYNC_PAGE,
      });
      useMessagesStore.getState().upsertMessages(conversationId, page.results);
      const next = contiguousMaxSeq(getConversationMessages(conversationId));
      if (!page.has_more || next <= from) break;
      from = next;
    }
    reportDelivered(conversationId);
  });
}

/** Opening a chat: sync from cache when we have one, otherwise fetch the latest page. */
export async function openConversationHistory(conversationId: string): Promise<void> {
  const current = getConversationMessages(conversationId);
  try {
    if (current && current.seqs.length > 0) await syncForward(conversationId);
    else await loadLatest(conversationId);
  } catch (error) {
    telemetry.warn('history', 'open history failed', { error: String(error) });
    throw error;
  }
}

/** Resync step for one conversation after reconnect (PROTOCOL §4.1 step 5). */
export async function resyncIfBehind(conversationId: string): Promise<void> {
  const current = getConversationMessages(conversationId);
  if (!current || current.seqs.length === 0) return;
  const lastSeq = useConversationsStore.getState().byId[conversationId]?.last_seq ?? 0;
  if (lastSeq > maxSeq(current) || contiguousMaxSeq(current) !== maxSeq(current)) {
    await syncForward(conversationId);
  }
}
