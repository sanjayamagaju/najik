import { resyncIfBehind } from '@/features/messages/services/history';
import { reportDeliveredForAll } from '@/features/messages/services/receipts';
import { outbox } from '@/features/messages/services/send';
import { resubscribePresence } from '@/features/presence/presenceService';
import { conversationsApi } from '@/services/api/endpoints';
import { telemetry } from '@/services/telemetry';
import { useConversationsStore } from '@/store/conversationsStore';
import { useUiStore } from '@/store/uiStore';

let running: Promise<void> | null = null;
let again = false;

/** Fetches the first page of conversations into the store. */
export async function refreshConversations(): Promise<void> {
  const page = await conversationsApi.list({ limit: 30 });
  useConversationsStore.getState().upsertMany(page.results, {
    firstPage: true,
    nextCursor: page.next_cursor,
  });
}

async function runOnce(): Promise<void> {
  // 1. First page of conversations.
  try {
    await refreshConversations();
    reportDeliveredForAll();
  } catch (error) {
    telemetry.warn('resync', 'conversations refresh failed', { error: String(error) });
  }

  // 2. Forward-sync every locally cached conversation that is behind (open chat first).
  const active = useUiStore.getState().activeConversationId;
  const ids = Object.keys(useConversationsStore.getState().byId).sort((a, b) =>
    a === active ? -1 : b === active ? 1 : 0,
  );
  for (const id of ids) {
    try {
      await resyncIfBehind(id);
    } catch (error) {
      telemetry.warn('resync', 'conversation sync failed', { error: String(error) });
    }
  }

  // 3. Flush unacked sends (idempotent by client_id).
  await outbox.flush();

  // 4. Re-subscribe to presence for the new socket.
  await resubscribePresence();
}

/** PROTOCOL §4.1 step 5 — run after every (re)connect. Coalesces overlapping calls. */
export function resync(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await runOnce();
    } while (again);
  })()
    .catch((error: unknown) => telemetry.error('resync', 'resync failed', error))
    .finally(() => {
      running = null;
    });
  return running;
}
