import { readFileSync } from 'node:fs';
import { cert, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { env } from '../config/env.js';
import { pushTokens } from '../db/pushTokens.js';

let messaging: Messaging | null = null;
let logOnly = false;

function loadServiceAccount(): ServiceAccount | null {
  try {
    if (env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
      return JSON.parse(Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')) as ServiceAccount;
    }
    if (env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      return JSON.parse(readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8')) as ServiceAccount;
    }
  } catch (err) {
    console.error('✖ Could not read the Firebase service account:', (err as Error).message);
  }
  return null;
}

export function initPush(): void {
  if (env.FCM_LOG_ONLY) {
    logOnly = true;
    console.warn('⚠ FCM_LOG_ONLY=1 — pushes are printed, not sent.');
    return;
  }
  const account = loadServiceAccount();
  if (!account) {
    console.warn('⚠ Firebase not configured — no push for incoming calls while the app is closed.');
    return;
  }
  messaging = getMessaging(initializeApp({ credential: cert(account) }));
  console.log('✔ Firebase Cloud Messaging enabled');
}

export const pushEnabled = () => messaging !== null || logOnly;

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/**
 * Data-only, high-priority message: it wakes the app even when it was swiped
 * away, and the native FirebaseMessagingService decides how to present it.
 */
async function sendData(userId: string, data: Record<string, string>, ttlMs: number): Promise<void> {
  const tokens = pushTokens.forUser(userId);
  if (tokens.length === 0) return;
  if (logOnly) {
    console.log(`[push] → ${userId} (${tokens.length} device${tokens.length > 1 ? 's' : ''})`, JSON.stringify(data));
    return;
  }
  if (!messaging) return;
  try {
    const res = await messaging.sendEachForMulticast({
      tokens,
      data,
      android: { priority: 'high', ttl: ttlMs },
    });
    const dead = res.responses.flatMap((r, i) => (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code) ? [tokens[i]] : []));
    if (dead.length) pushTokens.purge(dead);
  } catch (err) {
    console.error('FCM send failed:', (err as Error).message);
  }
}

export function pushIncomingCall(
  calleeId: string,
  call: { callId: string; caller: { id: string; displayName: string; username: string; avatarHue: number }; media: 'audio' | 'video' },
): void {
  const ttlMs = env.CALL_RING_TIMEOUT_SECONDS * 1000;
  void sendData(
    calleeId,
    {
      type: 'call',
      callId: call.callId,
      callerId: call.caller.id,
      callerName: call.caller.displayName,
      callerUsername: call.caller.username,
      callerHue: String(call.caller.avatarHue),
      media: call.media,
      ttlMs: String(ttlMs),
    },
    ttlMs,
  );
}

/** Dismisses the ringing notification on the callee's devices. */
export function pushCallEnded(calleeId: string, callId: string, reason: string): void {
  void sendData(calleeId, { type: 'call-end', callId, reason }, 60_000);
}
