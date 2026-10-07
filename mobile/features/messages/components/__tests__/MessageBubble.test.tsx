import { fireEvent, render, screen } from '@testing-library/react-native';

import type { LocalMessage } from '@/store/messagesModel';
import type { Message, MessageStatus } from '@/types/protocol';

import type { MessageItem } from '../../model/threadItems';
import { MessageBubble } from '../MessageBubble';

function serverItem(overrides: Partial<Message> = {}, isMine = true): MessageItem {
  const message: Message = {
    id: 'm1',
    client_id: 'k1',
    conversation_id: 'c1',
    sender_id: isMine ? 'me' : 'peer',
    seq: 1,
    kind: 'text',
    body: 'Hello there',
    meta: {},
    created_at: '2026-10-07T09:41:00.000Z',
    ...overrides,
  };
  return { type: 'message', key: message.client_id, message, isMine, position: 'single' };
}

function localItem(state: LocalMessage['state']): MessageItem {
  const message: LocalMessage = {
    client_id: 'local-1',
    conversation_id: 'c1',
    sender_id: 'me',
    kind: 'text',
    body: 'On my way',
    created_at: '2026-10-07T09:41:00.000Z',
    state,
  };
  return { type: 'message', key: message.client_id, message, isMine: true, position: 'single' };
}

describe('MessageBubble', () => {
  it.each<[MessageStatus, string]>([
    ['sent', 'Sent'],
    ['delivered', 'Delivered'],
    ['read', 'Read'],
  ])('shows the %s tick on my messages', async (status, label) => {
    await render(<MessageBubble item={serverItem()} status={status} peerName="Arjun" />);
    expect(screen.getByText('Hello there')).toBeTruthy();
    expect(screen.getByTestId(`status-${status}`)).toBeTruthy();
    expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it('shows a clock while sending', async () => {
    await render(<MessageBubble item={localItem('sending')} status="sending" peerName="Arjun" />);
    expect(screen.getByTestId('status-sending')).toBeTruthy();
    expect(screen.queryByText(/Tap to retry/)).toBeNull();
  });

  it('failed messages offer "Tap to retry" with the client_id', async () => {
    const onRetry = jest.fn();
    await render(
      <MessageBubble
        item={localItem('failed')}
        status="failed"
        peerName="Arjun"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByTestId('status-failed')).toBeTruthy();
    await fireEvent.press(screen.getByText('Not sent · Tap to retry'));
    expect(onRetry).toHaveBeenCalledWith('local-1');
  });

  it('incoming messages have no ticks and an accessible sender label', async () => {
    await render(<MessageBubble item={serverItem({}, false)} status={null} peerName="Arjun" />);
    expect(screen.queryByTestId(/^status-/)).toBeNull();
    expect(screen.getByLabelText(/^Arjun: Hello there/)).toBeTruthy();
  });

  it('renders 1–3 emoji-only messages as jumbo emoji', async () => {
    await render(
      <MessageBubble item={serverItem({ body: '🎉🔥' })} status="sent" peerName="Arjun" />,
    );
    expect(screen.getByTestId('jumbo-emoji')).toBeTruthy();
  });

  it('renders pings as a card', async () => {
    await render(
      <MessageBubble
        item={serverItem({ kind: 'ping', body: '' }, false)}
        status={null}
        peerName="Arjun"
      />,
    );
    expect(screen.getByText('Arjun pinged you')).toBeTruthy();
  });

  it('renders call log entries', async () => {
    await render(
      <MessageBubble
        item={serverItem(
          { kind: 'call', body: '', meta: { call_id: 'x', media: 'audio', outcome: 'missed' } },
          false,
        )}
        status={null}
        peerName="Arjun"
      />,
    );
    expect(screen.getByText('Missed voice call')).toBeTruthy();
  });

  it('call log entries offer tap-to-call-back with the same media', async () => {
    const onCallBack = jest.fn();
    await render(
      <MessageBubble
        item={serverItem(
          { kind: 'call', body: '', meta: { call_id: 'x', media: 'video', outcome: 'completed' } },
          false,
        )}
        status={null}
        peerName="Arjun"
        onCallBack={onCallBack}
      />,
    );
    await fireEvent.press(screen.getByRole('button'));
    expect(onCallBack).toHaveBeenCalledWith('video');
  });
});
