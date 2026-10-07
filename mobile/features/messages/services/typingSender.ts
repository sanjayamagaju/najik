import { wsClient } from '@/services/websocket';

/**
 * Outgoing typing indicator with throttling: `start` at most every 4 s while the user keeps
 * typing (the receiver auto-expires after 6 s), `stop` after 3 s of inactivity, on send and
 * on leaving the chat. Stays well under the 20 per 10 s rate limit.
 */
const RESEND_START_MS = 4_000;
const IDLE_STOP_MS = 3_000;

interface TypingSession {
  lastStartAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, TypingSession>();

function send(conversationId: string, state: 'start' | 'stop'): boolean {
  return wsClient().send('typing', { conversation_id: conversationId, state });
}

export function notifyTyping(conversationId: string, now = Date.now()): void {
  let session = sessions.get(conversationId);
  if (!session) {
    session = { lastStartAt: 0, idleTimer: null };
    sessions.set(conversationId, session);
  }
  if (now - session.lastStartAt >= RESEND_START_MS) {
    if (send(conversationId, 'start')) session.lastStartAt = now;
  }
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => stopTyping(conversationId), IDLE_STOP_MS);
}

export function stopTyping(conversationId: string): void {
  const session = sessions.get(conversationId);
  if (!session) return;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  sessions.delete(conversationId);
  if (session.lastStartAt > 0) send(conversationId, 'stop');
}

export function stopAllTyping(): void {
  for (const id of [...sessions.keys()]) stopTyping(id);
}
