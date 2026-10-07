import { presenceApi } from '@/services/api/endpoints';
import { telemetry } from '@/services/telemetry';
import { wsClient } from '@/services/websocket';
import { selectSortedConversationIds, useConversationsStore } from '@/store/conversationsStore';
import { usePresenceStore } from '@/store/presenceStore';

/** PROTOCOL §4.2: `presence.subscribe` takes at most 200 user ids and replaces the set. */
export const MAX_PRESENCE_SUBSCRIPTIONS = 200;

/** Peers of the most recently active conversations, deduped, capped at 200. */
export function selectPresenceTargets(): string[] {
  const { byId } = useConversationsStore.getState();
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of selectSortedConversationIds({ byId })) {
    const peerId = byId[id]?.peer.id;
    if (!peerId || seen.has(peerId)) continue;
    seen.add(peerId);
    ids.push(peerId);
    if (ids.length >= MAX_PRESENCE_SUBSCRIPTIONS) break;
  }
  return ids;
}

let lastSubscribedKey = '';
let debounce: ReturnType<typeof setTimeout> | null = null;
let unsubscribeStore: (() => void) | null = null;

/** (Re)subscribes over the socket, or falls back to a REST snapshot when the socket is down. */
export async function syncPresence(force = false): Promise<void> {
  const ids = selectPresenceTargets();
  const key = ids.join(',');
  if (!force && key === lastSubscribedKey) return;
  const ws = wsClient();
  try {
    if (ws.isOpen()) {
      const ack = await ws.request('presence.subscribe', { user_ids: ids });
      lastSubscribedKey = key;
      usePresenceStore.getState().setMany(ack.presence);
    } else if (ids.length > 0) {
      usePresenceStore.getState().setMany(await presenceApi.get(ids));
    }
  } catch (error) {
    telemetry.warn('presence', 'presence sync failed', { error: String(error) });
  }
}

/** Keeps the subscription in step with the chat list (debounced). */
export function startPresenceTracking(): void {
  stopPresenceTracking();
  unsubscribeStore = useConversationsStore.subscribe((s, prev) => {
    if (s.byId === prev.byId) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void syncPresence(), 600);
  });
}

export function stopPresenceTracking(): void {
  unsubscribeStore?.();
  unsubscribeStore = null;
  if (debounce) clearTimeout(debounce);
  debounce = null;
  lastSubscribedKey = '';
}

/** Called after every (re)connect: the server forgets subscriptions with the old socket. */
export function resubscribePresence(): Promise<void> {
  lastSubscribedKey = '';
  return syncPresence(true);
}
