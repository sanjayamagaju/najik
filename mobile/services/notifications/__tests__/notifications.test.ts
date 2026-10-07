import { extractPushData, parsePushPayload } from '../payloads';
import {
  decideForegroundPresentation,
  registerPushHandler,
  routeForPayload,
} from '../presentation';

const message = {
  type: 'message',
  conversation_id: 'c1',
  message_id: 'm1',
  sender_name: 'Arjun',
  preview: 'hey',
};

describe('push payload parsing', () => {
  it('parses every contract payload kind', () => {
    expect(parsePushPayload(message)).toEqual(message);
    expect(
      parsePushPayload({ type: 'ping', conversation_id: 'c1', sender_name: 'A' }),
    ).toMatchObject({ type: 'ping' });
    expect(
      parsePushPayload({
        type: 'call.incoming',
        call_id: 'k',
        caller_id: 'u',
        caller_name: 'A',
        media: 'video',
        expires_at: 'x',
      }),
    ).toMatchObject({ type: 'call.incoming', media: 'video' });
    expect(parsePushPayload({ type: 'call.ended', call_id: 'k', reason: 'missed' })).toMatchObject({
      type: 'call.ended',
    });
  });

  it('rejects malformed or unknown payloads', () => {
    expect(parsePushPayload(null)).toBeNull();
    expect(parsePushPayload({ type: 'message' })).toBeNull();
    expect(parsePushPayload({ type: 'nope', conversation_id: 'c' })).toBeNull();
  });

  it('extracts data from content, FCM remoteMessage or APNs payload', () => {
    expect(extractPushData({ content: { data: message }, trigger: null })).toEqual(message);
    expect(
      extractPushData({
        content: { data: {} },
        trigger: { type: 'push', remoteMessage: { data: message } },
      }),
    ).toEqual(message);
    expect(
      extractPushData({ content: { data: null }, trigger: { type: 'push', payload: message } }),
    ).toEqual(message);
    expect(extractPushData({ content: {}, trigger: null })).toBeNull();
  });
});

describe('foreground presentation policy', () => {
  const payload = parsePushPayload(message);

  it('suppresses duplicates for the chat that is open', () => {
    expect(
      decideForegroundPresentation(payload, { activeConversationId: 'c1', appActive: true }),
    ).toEqual({ kind: 'suppress' });
  });

  it('shows an in-app toast for other chats instead of the system banner', () => {
    expect(
      decideForegroundPresentation(payload, { activeConversationId: 'c2', appActive: true }),
    ).toMatchObject({
      kind: 'toast',
      conversationId: 'c1',
      title: 'Arjun',
      body: 'hey',
    });
  });

  it('suppresses ping pushes in the foreground (the socket plays the wave)', () => {
    const ping = parsePushPayload({ type: 'ping', conversation_id: 'c1', sender_name: 'A' });
    expect(
      decideForegroundPresentation(ping, { activeConversationId: null, appActive: true }),
    ).toEqual({ kind: 'suppress' });
  });

  it('falls back to the OS for unknown payloads and types without a handler', () => {
    expect(
      decideForegroundPresentation(null, { activeConversationId: null, appActive: true }),
    ).toEqual({ kind: 'system' });
    const call = parsePushPayload({ type: 'call.ended', call_id: 'k', reason: 'missed' });
    expect(
      decideForegroundPresentation(call, { activeConversationId: null, appActive: true }),
    ).toEqual({ kind: 'system' });
  });

  it('lets phase 2 register handlers for new push types', () => {
    const call = parsePushPayload({
      type: 'call.incoming',
      call_id: 'k',
      caller_id: 'u',
      caller_name: 'A',
      media: 'audio',
      expires_at: 'x',
    });
    const off = registerPushHandler('call.incoming', {
      foreground: () => ({ kind: 'suppress' }),
      routeOnTap: (p) => `/call/${p.caller_id}`,
    });
    expect(
      decideForegroundPresentation(call, { activeConversationId: null, appActive: true }),
    ).toEqual({ kind: 'suppress' });
    expect(routeForPayload(call)).toBe('/call/u');
    off();
    expect(routeForPayload(call)).toBeNull();
  });

  it('routes message and ping taps to the conversation', () => {
    expect(routeForPayload(payload)).toBe('/chat/c1');
    expect(
      routeForPayload(parsePushPayload({ type: 'ping', conversation_id: 'c9', sender_name: '' })),
    ).toBe('/chat/c9');
  });
});
