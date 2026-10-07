import * as Crypto from 'expo-crypto';

import { ingestMessage } from '@/features/messages/services/ingest';
import { conversationsApi } from '@/services/api/endpoints';
import { normalizeError } from '@/services/api/errors';
import { telemetry } from '@/services/telemetry';
import { wsClient, WsRequestError } from '@/services/websocket';
import { useConnectionStore } from '@/store/connectionStore';
import { useUiStore } from '@/store/uiStore';
import type { Message, PublicUser } from '@/types/protocol';
import { haptics } from '@/utils/haptics';

/** PROTOCOL §4.5: 1 ping per 5 s per (sender, conversation). */
export const PING_COOLDOWN_MS = 5_000;

export type PingResult =
  | { ok: true; message: Message }
  | { ok: false; reason: 'cooldown' | 'offline' | 'rate_limited' | 'error'; retryAfterMs?: number };

export function getPingCooldownRemaining(conversationId: string, now = Date.now()): number {
  const until = useUiStore.getState().pingCooldownUntil[conversationId] ?? 0;
  return Math.max(0, until - now);
}

/**
 * Pings are NOT queued in the outbox: a ping delivered minutes later is meaningless, so
 * offline pings fail fast with a friendly message instead.
 */
export async function sendPing(conversationId: string): Promise<PingResult> {
  const ui = useUiStore.getState();
  const remaining = getPingCooldownRemaining(conversationId);
  if (remaining > 0) return { ok: false, reason: 'cooldown', retryAfterMs: remaining };

  const ws = wsClient();
  const online = useConnectionStore.getState().networkAvailable;
  if (!ws.isOpen() && !online) {
    ui.showToast({ kind: 'error', title: "You're offline", body: 'Pings need a connection.' });
    return { ok: false, reason: 'offline' };
  }

  const clientId = Crypto.randomUUID();
  // Optimistic cooldown so double-taps never hit the server limit.
  ui.setPingCooldown(conversationId, Date.now() + PING_COOLDOWN_MS);
  try {
    const message = ws.isOpen()
      ? (await ws.request('ping.send', { conversation_id: conversationId, client_id: clientId }))
          .message
      : await conversationsApi.ping(conversationId, clientId);
    ingestMessage(message);
    haptics.success();
    return { ok: true, message };
  } catch (error) {
    const code = error instanceof WsRequestError ? error.code : normalizeError(error).code;
    const retryAfterSec =
      error instanceof WsRequestError ? error.retryAfterSec : normalizeError(error).retryAfterSec;
    if (code === 'rate_limited') {
      const retryAfterMs = Math.max(PING_COOLDOWN_MS, (retryAfterSec ?? 5) * 1000);
      ui.setPingCooldown(conversationId, Date.now() + retryAfterMs);
      ui.showToast({
        kind: 'ping',
        title: 'Easy there!',
        body: `You can ping again in ${Math.ceil(retryAfterMs / 1000)}s.`,
      });
      haptics.warning();
      return { ok: false, reason: 'rate_limited', retryAfterMs };
    }
    ui.setPingCooldown(conversationId, 0);
    telemetry.warn('ping', 'ping failed', { code });
    ui.showToast({ kind: 'error', title: "Ping didn't go through", body: 'Please try again.' });
    return { ok: false, reason: 'error' };
  }
}

/** Incoming `ping.received`: record it and play the full-screen wave + haptic, on any screen. */
export function handlePingReceived(message: Message, from: PublicUser): void {
  ingestMessage(message);
  useUiStore.getState().showPingOverlay({
    id: message.id,
    conversationId: message.conversation_id,
    from: { id: from.id, display_name: from.display_name, avatar_color: from.avatar_color },
  });
  haptics.heavy();
}
