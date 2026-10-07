import { usePresenceStore } from '../presenceStore';
import { TYPING_EXPIRY_MS, useTypingStore } from '../typingStore';

describe('typing store', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useTypingStore.getState().reset();
  });
  afterEach(() => jest.useRealTimers());

  it('auto-expires typing:start after 6 s', () => {
    useTypingStore.getState().apply('c1', 'start');
    expect(useTypingStore.getState().byConversation.c1).toBe(true);
    jest.advanceTimersByTime(TYPING_EXPIRY_MS - 1);
    expect(useTypingStore.getState().byConversation.c1).toBe(true);
    jest.advanceTimersByTime(1);
    expect(useTypingStore.getState().byConversation.c1).toBeUndefined();
  });

  it('a repeated start re-arms the timer', () => {
    useTypingStore.getState().apply('c1', 'start');
    jest.advanceTimersByTime(5_000);
    useTypingStore.getState().apply('c1', 'start');
    jest.advanceTimersByTime(5_000);
    expect(useTypingStore.getState().byConversation.c1).toBe(true);
    jest.advanceTimersByTime(1_000);
    expect(useTypingStore.getState().byConversation.c1).toBeUndefined();
  });

  it('stop clears immediately and is isolated per conversation', () => {
    useTypingStore.getState().apply('c1', 'start');
    useTypingStore.getState().apply('c2', 'start');
    useTypingStore.getState().apply('c1', 'stop');
    expect(useTypingStore.getState().byConversation).toEqual({ c2: true });
  });
});

describe('presence store', () => {
  beforeEach(() => usePresenceStore.getState().reset());

  it('stores presence and avoids no-op updates', () => {
    const p = { user_id: 'u1', online: true, last_seen_at: null };
    usePresenceStore.getState().set(p);
    const before = usePresenceStore.getState().byUserId;
    usePresenceStore.getState().set({ ...p });
    expect(usePresenceStore.getState().byUserId).toBe(before);
    usePresenceStore
      .getState()
      .setMany([{ user_id: 'u1', online: false, last_seen_at: '2026-10-07T09:00:00.000Z' }]);
    expect(usePresenceStore.getState().byUserId.u1?.online).toBe(false);
  });

  it('markAllUnknown takes everyone offline when our socket is gone', () => {
    usePresenceStore.getState().setMany([
      { user_id: 'a', online: true, last_seen_at: null },
      { user_id: 'b', online: false, last_seen_at: null },
    ]);
    usePresenceStore.getState().markAllUnknown();
    expect(Object.values(usePresenceStore.getState().byUserId).every((p) => !p.online)).toBe(true);
  });
});
