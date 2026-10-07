import AsyncStorage from '@react-native-async-storage/async-storage';

import { useMessagesStore } from '@/store/messagesStore';
import { type OutboxEntry, selectOrderedOutbox, useOutboxStore } from '@/store/outboxStore';
import {
  hydrateUserStores,
  resetUserData,
  startUserPersistence,
  stopUserPersistence,
} from '@/store/persistence';
import type { Message } from '@/types/protocol';

import { createOutboxProcessor, type OutboxTransport } from '../outboxProcessor';

function entry(clientId: string, conversationId = 'c1', createdAt = '2026-10-07T10:00:00.000Z') {
  return {
    client_id: clientId,
    conversation_id: conversationId,
    sender_id: 'me',
    body: `body ${clientId}`,
    created_at: createdAt,
  };
}

function serverMessage(e: OutboxEntry, seq: number): Message {
  return {
    id: `m-${e.client_id}`,
    client_id: e.client_id,
    conversation_id: e.conversation_id,
    sender_id: e.sender_id,
    seq,
    kind: 'text',
    body: e.body,
    meta: {},
    created_at: e.created_at,
  };
}

function transport(overrides: Partial<OutboxTransport> = {}): OutboxTransport & { sent: string[] } {
  const sent: string[] = [];
  let seq = 0;
  return {
    sent,
    isOnline: () => true,
    isSocketOpen: () => true,
    sendViaSocket: jest.fn(async (e: OutboxEntry) => {
      sent.push(e.client_id);
      return serverMessage(e, ++seq);
    }),
    sendViaRest: jest.fn(async (e: OutboxEntry) => {
      sent.push(`rest:${e.client_id}`);
      return serverMessage(e, ++seq);
    }),
    ...overrides,
  };
}

beforeEach(async () => {
  useOutboxStore.getState().reset();
  useMessagesStore.getState().reset();
  await AsyncStorage.clear();
});

describe('outbox processor', () => {
  it('flushes oldest-first and removes acked entries', async () => {
    useOutboxStore.getState().enqueue(entry('b', 'c1', '2026-10-07T10:00:02.000Z'));
    useOutboxStore.getState().enqueue(entry('a', 'c1', '2026-10-07T10:00:01.000Z'));
    const t = transport();
    const onAcked = jest.fn();
    const p = createOutboxProcessor({ transport: t, onAcked, onFailed: jest.fn() });
    await p.flush();
    expect(t.sent).toEqual(['a', 'b']);
    expect(onAcked).toHaveBeenCalledTimes(2);
    expect(useOutboxStore.getState().entries).toEqual({});
  });

  it('falls back to REST when the socket is down but the network is up', async () => {
    useOutboxStore.getState().enqueue(entry('a'));
    const t = transport({ isSocketOpen: () => false });
    await createOutboxProcessor({ transport: t, onAcked: jest.fn(), onFailed: jest.fn() }).flush();
    expect(t.sent).toEqual(['rest:a']);
  });

  it('stays queued (status sending) while offline', async () => {
    useOutboxStore.getState().enqueue(entry('a'));
    const t = transport({ isSocketOpen: () => false, isOnline: () => false });
    await createOutboxProcessor({ transport: t, onAcked: jest.fn(), onFailed: jest.fn() }).flush();
    expect(t.sent).toEqual([]);
    expect(useOutboxStore.getState().entries.a?.status).toBe('queued');
  });

  it('a permanent error marks the message failed (Tap to retry) and retry resends idempotently', async () => {
    useOutboxStore.getState().enqueue(entry('a'));
    let fail = true;
    const t = transport({
      sendViaSocket: jest.fn(async (e: OutboxEntry) => {
        if (fail) throw Object.assign(new Error('bad'), { code: 'validation_error' });
        return serverMessage(e, 1);
      }),
    });
    const onFailed = jest.fn();
    const onRequeued = jest.fn();
    const p = createOutboxProcessor({ transport: t, onAcked: jest.fn(), onFailed, onRequeued });
    await p.flush();
    expect(useOutboxStore.getState().entries.a?.status).toBe('failed');
    expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'a' }));
    fail = false;
    await p.retry('a');
    expect(onRequeued).toHaveBeenCalled();
    expect(useOutboxStore.getState().entries.a).toBeUndefined();
    expect(t.sendViaSocket).toHaveBeenLastCalledWith(expect.objectContaining({ client_id: 'a' }));
  });

  it('rate limits pause the conversation (preserving order) without counting an attempt', async () => {
    jest.useFakeTimers();
    try {
      useOutboxStore.getState().enqueue(entry('a', 'c1', '2026-10-07T10:00:01.000Z'));
      useOutboxStore.getState().enqueue(entry('b', 'c1', '2026-10-07T10:00:02.000Z'));
      useOutboxStore.getState().enqueue(entry('x', 'c2', '2026-10-07T10:00:03.000Z'));
      let limited = true;
      const t = transport({
        sendViaSocket: jest.fn(async (e: OutboxEntry) => {
          if (e.conversation_id === 'c1' && limited) {
            limited = false;
            throw Object.assign(new Error('slow'), { code: 'rate_limited', retryAfterSec: 2 });
          }
          return serverMessage(e, 1);
        }),
      });
      const p = createOutboxProcessor({ transport: t, onAcked: jest.fn(), onFailed: jest.fn() });
      await p.flush();
      // c2 was not blocked by c1's limit; b waited behind a.
      expect(useOutboxStore.getState().entries.x).toBeUndefined();
      expect(useOutboxStore.getState().entries.a).toMatchObject({ status: 'queued', attempts: 0 });
      expect(useOutboxStore.getState().entries.b?.status).toBe('queued');
      await jest.advanceTimersByTimeAsync(2_000);
      expect(useOutboxStore.getState().entries).toEqual({});
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives up after max attempts on transient errors', async () => {
    jest.useFakeTimers();
    try {
      useOutboxStore.getState().enqueue(entry('a'));
      const t = transport({
        sendViaSocket: jest.fn(async () => {
          throw Object.assign(new Error('timeout'), { code: 'ack_timeout' });
        }),
      });
      const onFailed = jest.fn();
      const p = createOutboxProcessor({
        transport: t,
        onAcked: jest.fn(),
        onFailed,
        maxAttempts: 3,
        random: () => 0,
      });
      await p.flush();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(t.sendViaSocket).toHaveBeenCalledTimes(3);
      expect(useOutboxStore.getState().entries.a?.status).toBe('failed');
      expect(onFailed).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('outbox persistence', () => {
  it('survives an app kill: entries and optimistic bubbles are restored, in-flight sends are re-queued', async () => {
    startUserPersistence('me');
    useOutboxStore.getState().enqueue(entry('a'));
    useOutboxStore.getState().enqueue(entry('b', 'c1', '2026-10-07T10:00:05.000Z'));
    useOutboxStore.getState().markInflight('a');
    useOutboxStore.getState().markFailed('b', 'validation_error');
    await new Promise((r) => setTimeout(r, 0));
    stopUserPersistence();

    // "Kill": wipe memory only.
    useOutboxStore.getState().reset();
    useMessagesStore.getState().reset();

    await hydrateUserStores('me');
    const restored = selectOrderedOutbox(useOutboxStore.getState());
    expect(restored.map((e) => [e.client_id, e.status])).toEqual([
      ['a', 'queued'],
      ['b', 'failed'],
    ]);
    const locals = useMessagesStore.getState().byConversation.c1?.local ?? [];
    expect(locals.map((l) => [l.client_id, l.state])).toEqual([
      ['a', 'sending'],
      ['b', 'failed'],
    ]);
  });

  it('never restores another user’s outbox', async () => {
    startUserPersistence('me');
    useOutboxStore.getState().enqueue(entry('a'));
    await new Promise((r) => setTimeout(r, 0));
    stopUserPersistence();
    useOutboxStore.getState().reset();
    await hydrateUserStores('someone-else');
    expect(useOutboxStore.getState().entries).toEqual({});
  });

  it('a corrupt cache entry is discarded instead of crashing', async () => {
    await AsyncStorage.setItem('najik.cache.outbox', '{not json');
    await expect(hydrateUserStores('me')).resolves.toBeUndefined();
    expect(useOutboxStore.getState().entries).toEqual({});
  });

  it('sign-out wipes user caches', async () => {
    startUserPersistence('me');
    useOutboxStore.getState().enqueue(entry('a'));
    await new Promise((r) => setTimeout(r, 0));
    await resetUserData();
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.filter((k) => k.startsWith('najik.cache.'))).toEqual([]);
  });
});
