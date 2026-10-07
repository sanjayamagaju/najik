import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { useAuthStore } from '@/store/authStore';
import { useConversationsStore } from '@/store/conversationsStore';
import { useTypingStore } from '@/store/typingStore';
import type { Conversation, Message } from '@/types/protocol';

import { ChatListItem, ChatListRow, previewFor } from '../ChatListItem';

const peer = {
  id: 'peer',
  username: 'arjun',
  display_name: 'Arjun Rai',
  avatar_color: '#7C5CFF',
  created_at: '2026-01-01T00:00:00.000Z',
};

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm9',
    client_id: 'k9',
    conversation_id: 'c1',
    sender_id: 'peer',
    seq: 9,
    kind: 'text',
    body: 'See you\nsoon',
    meta: {},
    created_at: '2026-10-07T09:41:00.000Z',
    ...overrides,
  };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    peer,
    last_message: message(),
    last_seq: 9,
    unread_count: 3,
    my_read_seq: 6,
    peer_delivered_seq: 9,
    peer_read_seq: 8,
    updated_at: '2026-10-07T09:41:00.000Z',
    ...overrides,
  };
}

describe('ChatListRow', () => {
  it('shows name, single-line preview, unread badge and opens the chat', async () => {
    const onPress = jest.fn();
    await render(
      <ChatListRow
        conversation={conversation()}
        myUserId="me"
        online
        typing={false}
        onPress={onPress}
      />,
    );
    expect(screen.getByText('Arjun Rai')).toBeTruthy();
    expect(screen.getByText('See you soon')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByLabelText(/Arjun Rai, online, See you soon, 3 unread/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('chat-row-c1'));
    expect(onPress).toHaveBeenCalledWith('c1');
  });

  it('shows "typing…" instead of the preview', async () => {
    await render(
      <ChatListRow
        conversation={conversation()}
        myUserId="me"
        online={false}
        typing
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('typing…')).toBeTruthy();
    expect(screen.queryByText('See you soon')).toBeNull();
  });

  it('shows derived ticks for my last message', async () => {
    const conv = conversation({
      last_message: message({ sender_id: 'me', seq: 9 }),
      unread_count: 0,
      peer_read_seq: 9,
    });
    await render(
      <ChatListRow
        conversation={conv}
        myUserId="me"
        online={false}
        typing={false}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByTestId('status-read')).toBeTruthy();
  });

  it('previews pings and calls with icons', () => {
    expect(
      previewFor(conversation({ last_message: message({ kind: 'ping', body: '' }) }), 'me').text,
    ).toBe('Pinged you');
    expect(
      previewFor(
        conversation({
          last_message: message({
            kind: 'call',
            body: '',
            meta: { call_id: 'x', media: 'video', outcome: 'missed' },
          }),
        }),
        'me',
      ),
    ).toMatchObject({ text: 'Missed video call', missed: true, icon: 'videocam' });
    expect(previewFor(conversation({ last_message: null }), 'me').text).toBe('Say hi 👋');
  });
});

describe('ChatListItem (connected)', () => {
  afterEach(async () => {
    await act(async () => {
      useTypingStore.getState().reset();
    });
  });
  beforeEach(() => {
    useConversationsStore.getState().reset();
    useTypingStore.getState().reset();
    useAuthStore.setState({
      status: 'signedIn',
      user: { ...peer, id: 'me', username: 'me', display_name: 'Me', email: null },
    });
  });

  it('renders from the stores and reflects typing updates', async () => {
    useConversationsStore.getState().upsert(conversation());
    await render(<ChatListItem conversationId="c1" onPress={jest.fn()} />);
    expect(screen.getByText('See you soon')).toBeTruthy();
    await act(async () => {
      useTypingStore.getState().apply('c1', 'start');
    });
    expect(screen.getByText('typing…')).toBeTruthy();
  });
});
