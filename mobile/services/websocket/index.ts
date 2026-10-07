import { getConfig } from '@/config/env';
import { tokenManager } from '@/services/api/instance';

import { type AuthRejectionReason, WsClient } from './WsClient';

export {
  WsClient,
  WsRequestError,
  CLOSE_CODES,
  type WsState,
  type WebSocketLike,
  type AuthRejectionReason,
} from './WsClient';

let instance: WsClient | null = null;
let authRejectedHandler: ((reason: AuthRejectionReason) => void) | null = null;

/** Set by the auth feature: a 4004 / session.revoked / invalid token ends the session. */
export function setWsAuthRejectedHandler(handler: (reason: AuthRejectionReason) => void): void {
  authRejectedHandler = handler;
}

/**
 * The app-wide WebSocket client. It is a singleton that lives for the whole process and is
 * started/stopped with the session, so `wsClient().on(...)` subscriptions made at module
 * load (e.g. the `call.*` handlers in features/calls) survive sign-out/sign-in cycles.
 */
export function wsClient(): WsClient {
  instance ??= new WsClient({
    url: getConfig().wsUrl,
    getAccessToken: () => tokenManager.getValidAccessToken(),
    refreshAccessToken: () => tokenManager.refresh(),
    onAuthRejected: (reason) => authRejectedHandler?.(reason),
  });
  const ws = instance;
  tokenManager.onTokensRefreshed((tokens) => ws.reauthenticate(tokens.access));
  return instance;
}
