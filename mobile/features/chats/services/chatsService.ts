import { conversationsApi } from '@/services/api/endpoints';
import { refreshConversations } from '@/services/realtime/resync';
import { useConversationsStore } from '@/store/conversationsStore';
import type { Conversation } from '@/types/protocol';

export { refreshConversations };

let loadingMore: Promise<void> | null = null;

/** Next page of the chat list (cursor pagination). */
export function loadMoreConversations(): Promise<void> {
  const cursor = useConversationsStore.getState().nextCursor;
  if (!cursor) return Promise.resolve();
  loadingMore ??= (async () => {
    const page = await conversationsApi.list({ cursor, limit: 30 });
    useConversationsStore.getState().upsertMany(page.results, { nextCursor: page.next_cursor });
  })().finally(() => {
    loadingMore = null;
  });
  return loadingMore;
}

/** get-or-create the 1-to-1 conversation with a user. */
export async function startConversation(userId: string): Promise<Conversation> {
  const conversation = await conversationsApi.open(userId);
  useConversationsStore.getState().upsert(conversation);
  return conversation;
}
