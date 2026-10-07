import { clearAllCaches, createCache, createDebouncedWriter } from '@/services/storage/cache';
import { telemetry } from '@/services/telemetry';
import type { Me, Message } from '@/types/protocol';
import { filterValid, isConversation, isMe, isMessage, isObject } from '@/utils/guards';

import { useConnectionStore } from './connectionStore';
import { useConversationsStore } from './conversationsStore';
import {
  addLocalMessage,
  type ConversationMessages,
  emptyConversationMessages,
  mergeServerMessages,
  trimToNewest,
} from './messagesModel';
import { useMessagesStore } from './messagesStore';
import { isOutboxEntry, type OutboxEntry, useOutboxStore } from './outboxStore';
import { usePresenceStore } from './presenceStore';
import { parseSettings, useSettingsStore, type DeviceSettings } from './settingsStore';
import { useTypingStore } from './typingStore';
import { useUiStore } from './uiStore';

/**
 * Persistence of NON-SENSITIVE slices (tokens live in SecureStore).
 * Each cache is versioned and validated on read; anything malformed is discarded, so a bad
 * cache can never crash startup. User caches are owner-scoped and wiped on sign-out.
 */

const MESSAGES_PER_CONVERSATION = 50;

export const sessionUserCache = createCache<Me>({
  key: 'session.user',
  version: 1,
  parse: (d) => (isMe(d) ? d : null),
});

const conversationsCache = createCache({
  key: 'conversations',
  version: 1,
  parse: (d) => filterValid(d, isConversation),
});

const messagesCache = createCache<Record<string, Message[]>>({
  key: 'messages',
  version: 1,
  parse: (d) => {
    if (!isObject(d)) return null;
    const out: Record<string, Message[]> = {};
    for (const [conversationId, list] of Object.entries(d)) {
      const valid = filterValid(list, isMessage);
      if (valid) out[conversationId] = valid;
    }
    return out;
  },
});

const outboxCache = createCache({
  key: 'outbox',
  version: 1,
  parse: (d) => filterValid(d, isOutboxEntry),
});

const settingsCache = createCache<Partial<DeviceSettings>>({
  key: 'settings',
  version: 1,
  scope: 'device',
  parse: parseSettings,
});

export function rebuildConversationMessages(messages: Message[]): ConversationMessages {
  const merged = mergeServerMessages(emptyConversationMessages(), messages);
  return { ...merged, hasMoreOlder: merged.seqs[0] !== 1 };
}

function outboxToLocal(entry: OutboxEntry) {
  return {
    client_id: entry.client_id,
    conversation_id: entry.conversation_id,
    sender_id: entry.sender_id,
    kind: 'text' as const,
    body: entry.body,
    created_at: entry.created_at,
    state: entry.status === 'failed' ? ('failed' as const) : ('sending' as const),
  };
}

export async function hydrateDeviceSettings(): Promise<void> {
  const settings = await settingsCache.read(null);
  useSettingsStore.getState().hydrate(settings ?? {});
}

/** Loads the cached chats/messages/outbox for `userId` into the stores. Never throws. */
export async function hydrateUserStores(userId: string): Promise<void> {
  try {
    const [conversations, messages, outbox] = await Promise.all([
      conversationsCache.read(userId),
      messagesCache.read(userId),
      outboxCache.read(userId),
    ]);
    if (conversations) useConversationsStore.getState().hydrate(conversations);

    const byConversation: Record<string, ConversationMessages> = {};
    for (const [conversationId, list] of Object.entries(messages ?? {})) {
      byConversation[conversationId] = rebuildConversationMessages(list);
    }
    const entries = (outbox ?? []).filter((e) => e.sender_id === userId);
    for (const entry of entries) {
      const current = byConversation[entry.conversation_id] ?? emptyConversationMessages();
      byConversation[entry.conversation_id] = addLocalMessage(current, outboxToLocal(entry));
    }
    useMessagesStore.getState().hydrate(byConversation);
    useOutboxStore.getState().hydrate(entries);
  } catch (error) {
    telemetry.error('persistence', 'hydration failed; starting with empty stores', error);
  }
}

let unsubscribers: ((flush: boolean) => void)[] = [];
let flushPending: (() => void) | null = null;

/** Writes debounced changes now (call when the app goes to the background). */
export function flushUserPersistence(): void {
  flushPending?.();
}

/** Starts writing store changes back to the caches for `userId`. */
export function startUserPersistence(userId: string): void {
  stopUserPersistence();

  const conversationsWriter = createDebouncedWriter(() =>
    conversationsCache.write(Object.values(useConversationsStore.getState().byId), userId),
  );
  const messagesWriter = createDebouncedWriter(() => {
    const out: Record<string, Message[]> = {};
    for (const [conversationId, conv] of Object.entries(
      useMessagesStore.getState().byConversation,
    )) {
      const trimmed = trimToNewest(conv, MESSAGES_PER_CONVERSATION);
      out[conversationId] = trimmed.seqs
        .map((s) => trimmed.bySeq[s])
        .filter((m): m is Message => m !== undefined);
    }
    return messagesCache.write(out, userId);
  }, 800);

  // The outbox is written immediately (serialized) — losing a queued send on kill is not OK.
  let outboxChain: Promise<void> = Promise.resolve();
  const writeOutbox = () => {
    const entries = Object.values(useOutboxStore.getState().entries);
    outboxChain = outboxChain.then(() => outboxCache.write(entries, userId));
  };

  flushPending = () => {
    conversationsWriter.flush();
    messagesWriter.flush();
  };
  unsubscribers = [
    useConversationsStore.subscribe((s, prev) => {
      if (s.byId !== prev.byId) conversationsWriter.schedule();
    }),
    useMessagesStore.subscribe((s, prev) => {
      if (s.byConversation !== prev.byConversation) messagesWriter.schedule();
    }),
    useOutboxStore.subscribe((s, prev) => {
      if (s.entries !== prev.entries) writeOutbox();
    }),
    (flush) => {
      if (flush) {
        conversationsWriter.flush();
        messagesWriter.flush();
      } else {
        conversationsWriter.cancel();
        messagesWriter.cancel();
      }
    },
  ];
}

/** Stops persisting. `flush` writes pending changes first (e.g. app going to background). */
export function stopUserPersistence(flush = true): void {
  const list = unsubscribers;
  unsubscribers = [];
  flushPending = null;
  for (const fn of list) fn(flush);
}

/** Device settings persist across sign-outs. */
export function startSettingsPersistence(): () => void {
  return useSettingsStore.subscribe((s, prev) => {
    if (
      s.theme !== prev.theme ||
      s.haptics !== prev.haptics ||
      s.notificationsPrompted !== prev.notificationsPrompted
    ) {
      void settingsCache.write(
        { theme: s.theme, haptics: s.haptics, notificationsPrompted: s.notificationsPrompted },
        null,
      );
    }
  });
}

/** Wipes every user-scoped store and cache (sign-out, forced logout, account deletion). */
export async function resetUserData(): Promise<void> {
  stopUserPersistence(false);
  useConversationsStore.getState().reset();
  useMessagesStore.getState().reset();
  useOutboxStore.getState().reset();
  usePresenceStore.getState().reset();
  useTypingStore.getState().reset();
  useConnectionStore.getState().reset();
  useUiStore.getState().reset();
  await clearAllCaches();
}
