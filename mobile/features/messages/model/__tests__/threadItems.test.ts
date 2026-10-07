import {
  addLocalMessage,
  emptyConversationMessages,
  mergeServerMessages,
} from '@/store/messagesModel';
import type { Message } from '@/types/protocol';

import { buildThreadItems, type MessageItem } from '../threadItems';

function msg(seq: number, sender: string, at: string, kind: Message['kind'] = 'text'): Message {
  return {
    id: `m${seq}`,
    client_id: `c${seq}`,
    conversation_id: 'conv',
    sender_id: sender,
    seq,
    kind,
    body: kind === 'text' ? `m${seq}` : '',
    meta: {},
    created_at: at,
  };
}

describe('thread items (inverted list)', () => {
  const conv = mergeServerMessages(emptyConversationMessages(), [
    msg(1, 'peer', '2026-10-06T22:00:00.000Z'),
    msg(2, 'me', '2026-10-07T09:00:00.000Z'),
    msg(3, 'me', '2026-10-07T09:01:00.000Z'),
    msg(4, 'me', '2026-10-07T09:02:00.000Z'),
    msg(5, 'me', '2026-10-07T09:30:00.000Z'), // > 3 min later → new group
    msg(6, 'me', '2026-10-07T09:30:30.000Z', 'ping'), // pings never group
  ]);

  it('orders newest first with a day separator after each day’s oldest message', () => {
    const items = buildThreadItems(conv, 'me');
    expect(items.map((i) => (i.type === 'day' ? `day:${i.key.slice(4)}` : i.key))).toEqual([
      'c6',
      'c5',
      'c4',
      'c3',
      'c2',
      'day:2026-10-07',
      'c1',
      'day:2026-10-06',
    ]);
  });

  it('groups consecutive messages from the same sender within 3 minutes', () => {
    const items = buildThreadItems(conv, 'me').filter(
      (i): i is MessageItem => i.type === 'message',
    );
    const pos = Object.fromEntries(items.map((i) => [i.key, i.position]));
    expect(pos).toEqual({
      c6: 'single',
      c5: 'single',
      c4: 'last',
      c3: 'middle',
      c2: 'first',
      c1: 'single',
    });
    expect(items.find((i) => i.key === 'c2')?.isMine).toBe(true);
  });

  it('puts optimistic messages last (newest) keyed by client_id', () => {
    const withLocal = addLocalMessage(conv, {
      client_id: 'local-1',
      conversation_id: 'conv',
      sender_id: 'me',
      kind: 'text',
      body: 'hello',
      created_at: '2026-10-07T09:31:00.000Z',
      state: 'sending',
    });
    const [first] = buildThreadItems(withLocal, 'me');
    expect(first?.key).toBe('local-1');
  });
});
