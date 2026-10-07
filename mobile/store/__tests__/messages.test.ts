import type { Conversation, Message } from '@/types/protocol';

import { mergeConversation, useConversationsStore } from '../conversationsStore';
import {
  addLocalMessage,
  contiguousMaxSeq,
  deriveStatus,
  emptyConversationMessages,
  hasGap,
  type LocalMessage,
  maxSeq,
  mergeServerMessages,
  setLocalState,
  trimToNewest,
} from '../messagesModel';
import { useMessagesStore } from '../messagesStore';

const ME = 'me';
const PEER = 'peer';

function msg(seq: number, overrides: Partial<Message> = {}): Message {
  return {
    id: `m${seq}`,
    client_id: `c${seq}`,
    conversation_id: 'conv',
    sender_id: PEER,
    seq,
    kind: 'text',
    body: `message ${seq}`,
    meta: {},
    created_at: new Date(Date.UTC(2026, 9, 7, 9, seq)).toISOString(),
    ...overrides,
  };
}

function local(clientId: string, overrides: Partial<LocalMessage> = {}): LocalMessage {
  return {
    client_id: clientId,
    conversation_id: 'conv',
    sender_id: ME,
    kind: 'text',
    body: 'hi',
    created_at: '2026-10-07T10:00:00.000Z',
    state: 'sending',
    ...overrides,
  };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv',
    peer: {
      id: PEER,
      username: 'peer',
      display_name: 'Peer',
      avatar_color: '#7C5CFF',
      created_at: '2026-01-01T00:00:00.000Z',
    },
    last_message: null,
    last_seq: 0,
    unread_count: 0,
    my_read_seq: 0,
    peer_delivered_seq: 0,
    peer_read_seq: 0,
    updated_at: '2026-10-07T09:00:00.000Z',
    ...overrides,
  };
}

describe('messages model', () => {
  it('inserts optimistic messages and reconciles the ack by client_id', () => {
    let state = addLocalMessage(emptyConversationMessages(), local('k1'));
    expect(state.local).toHaveLength(1);
    state = mergeServerMessages(state, [msg(5, { client_id: 'k1', sender_id: ME })]);
    expect(state.local).toHaveLength(0);
    expect(state.seqs).toEqual([5]);
    expect(state.seqByClientId.k1).toBe(5);
  });

  it('does not re-add an optimistic copy once the server message is known', () => {
    const state = mergeServerMessages(emptyConversationMessages(), [
      msg(3, { client_id: 'k1', sender_id: ME }),
    ]);
    expect(addLocalMessage(state, local('k1'))).toBe(state);
  });

  it('dedupes repeated deliveries (ack + message.new + sync) and keeps seqs sorted', () => {
    let state = mergeServerMessages(emptyConversationMessages(), [msg(2), msg(1)]);
    const again = mergeServerMessages(state, [msg(2), msg(1)]);
    expect(again).toBe(state); // referentially unchanged → no re-render
    state = mergeServerMessages(state, [msg(4), msg(3), msg(4)]);
    expect(state.seqs).toEqual([1, 2, 3, 4]);
  });

  it('tracks failed / retried local state', () => {
    let state = addLocalMessage(emptyConversationMessages(), local('k1'));
    state = setLocalState(state, 'k1', 'failed');
    expect(state.local[0]?.state).toBe('failed');
    expect(setLocalState(state, 'k1', 'failed')).toBe(state);
  });

  it('detects gaps for out-of-order message.new and in the loaded window', () => {
    const state = mergeServerMessages(emptyConversationMessages(), [msg(1), msg(2), msg(3)]);
    expect(hasGap(state, 4)).toBe(false);
    expect(hasGap(state, 6)).toBe(true);
    const holed = mergeServerMessages(state, [msg(6)]);
    expect(maxSeq(holed)).toBe(6);
    expect(contiguousMaxSeq(holed)).toBe(3);
    expect(hasGap(holed)).toBe(true);
    expect(hasGap(undefined, 10)).toBe(false); // nothing loaded yet → nothing to compare
  });

  it('derives status from watermarks (never stored)', () => {
    const conv = { peer_delivered_seq: 5, peer_read_seq: 3 };
    expect(deriveStatus(local('a'), conv)).toBe('sending');
    expect(deriveStatus(local('b', { state: 'failed' }), conv)).toBe('failed');
    expect(deriveStatus(msg(3, { sender_id: ME }), conv)).toBe('read');
    expect(deriveStatus(msg(5, { sender_id: ME }), conv)).toBe('delivered');
    expect(deriveStatus(msg(6, { sender_id: ME }), conv)).toBe('sent');
  });

  it('trims to the newest N for the persisted cache', () => {
    const state = mergeServerMessages(
      emptyConversationMessages(),
      [1, 2, 3, 4, 5].map((s) => msg(s)),
    );
    const trimmed = trimToNewest(state, 2);
    expect(trimmed.seqs).toEqual([4, 5]);
    expect(Object.keys(trimmed.bySeq)).toEqual(['4', '5']);
    expect(trimmed.hasMoreOlder).toBe(true);
  });
});

describe('messages store', () => {
  beforeEach(() => useMessagesStore.getState().reset());

  it('upserts per conversation and updates hasMoreOlder from paging', () => {
    useMessagesStore.getState().upsertMessages('conv', [msg(10), msg(11)], { hasMoreOlder: false });
    const conv = useMessagesStore.getState().byConversation.conv;
    expect(conv?.seqs).toEqual([10, 11]);
    expect(conv?.hasMoreOlder).toBe(false);
  });

  it('resetWindow keeps optimistic messages', () => {
    useMessagesStore.getState().upsertMessages('conv', [msg(1)]);
    useMessagesStore.getState().addLocal(local('k9'));
    useMessagesStore.getState().resetWindow('conv');
    const conv = useMessagesStore.getState().byConversation.conv;
    expect(conv?.seqs).toEqual([]);
    expect(conv?.local.map((l) => l.client_id)).toEqual(['k9']);
  });
});

describe('conversations store', () => {
  beforeEach(() => useConversationsStore.getState().reset());

  it('watermarks never move backwards when a stale page arrives', () => {
    const fresh = conversation({ peer_read_seq: 9, peer_delivered_seq: 10, last_seq: 10 });
    const stale = conversation({ peer_read_seq: 4, peer_delivered_seq: 5, last_seq: 8 });
    const merged = mergeConversation(fresh, stale);
    expect(merged).toMatchObject({ peer_read_seq: 9, peer_delivered_seq: 10, last_seq: 10 });
  });

  it('applies receipts from the peer and from my other devices', () => {
    useConversationsStore
      .getState()
      .upsert(conversation({ last_seq: 10, unread_count: 2, my_read_seq: 8 }));
    useConversationsStore
      .getState()
      .applyReceipt({ conversation_id: 'conv', user_id: PEER, delivered_seq: 7, read_seq: 6 }, ME);
    expect(useConversationsStore.getState().byId.conv).toMatchObject({
      peer_delivered_seq: 7,
      peer_read_seq: 6,
    });
    // regressions are ignored
    useConversationsStore
      .getState()
      .applyReceipt({ conversation_id: 'conv', user_id: PEER, delivered_seq: 3, read_seq: 2 }, ME);
    expect(useConversationsStore.getState().byId.conv).toMatchObject({
      peer_delivered_seq: 7,
      peer_read_seq: 6,
    });
    // my other device read everything
    useConversationsStore
      .getState()
      .applyReceipt({ conversation_id: 'conv', user_id: ME, delivered_seq: 10, read_seq: 10 }, ME);
    expect(useConversationsStore.getState().byId.conv).toMatchObject({
      my_read_seq: 10,
      unread_count: 0,
    });
  });

  it('applies new messages: last message, unread count, ordering', () => {
    useConversationsStore.getState().upsert(conversation({ last_seq: 1 }));
    useConversationsStore
      .getState()
      .upsert(conversation({ id: 'other', updated_at: '2026-10-07T09:30:00.000Z' }));
    useConversationsStore.getState().applyMessage(msg(2), { myUserId: ME, countAsUnread: true });
    const conv = useConversationsStore.getState().byId.conv;
    expect(conv).toMatchObject({ last_seq: 2, unread_count: 1 });
    expect(conv?.last_message?.id).toBe('m2');
    // duplicate delivery does not double count
    useConversationsStore.getState().applyMessage(msg(2), { myUserId: ME, countAsUnread: true });
    expect(useConversationsStore.getState().byId.conv?.unread_count).toBe(1);
    // the chat is open → not unread
    useConversationsStore.getState().applyMessage(msg(3), { myUserId: ME, countAsUnread: false });
    expect(useConversationsStore.getState().byId.conv?.unread_count).toBe(1);
  });
});
