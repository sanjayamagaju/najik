import type { PushPayload, PushType } from '@/types/protocol';

import { presentPingNotification } from './localNotifications';

/**
 * Pure foreground-presentation policy + an extension registry for push types.
 *
 * The calls feature registers `call.incoming` / `call.ended` handlers (features/calls/push.ts)
 * via `registerPushHandler` instead of editing this file's built-ins.
 */

export interface ForegroundContext {
  activeConversationId: string | null;
  appActive: boolean;
}

export type ForegroundDecision =
  /** Let the OS present the banner/sound. */
  | { kind: 'system' }
  /** Suppress the OS banner and show our in-app toast instead. */
  | {
      kind: 'toast';
      conversationId: string;
      title: string;
      body: string;
      toastKind: 'message' | 'ping';
    }
  /** Suppress entirely (e.g. the chat is already open). */
  | { kind: 'suppress' };

export interface PushHandler<P extends PushPayload = PushPayload> {
  /** Decide what happens when this push arrives while the app is in the foreground. */
  foreground?: (payload: P, ctx: ForegroundContext) => ForegroundDecision;
  /** Route to open when the user taps the notification (null = just open the app). */
  routeOnTap?: (payload: P) => string | null;
  /** Side effects when received in the foreground (e.g. stop ringing). */
  onReceive?: (payload: P) => void;
  /**
   * Runs from the background/headless notification task for data-only pushes (Android ping,
   * `call.incoming` / `call.ended`). Skipped while the app is active unless
   * `skipBackgroundWhenActive` is false.
   */
  onBackground?: (payload: P) => Promise<void> | void;
  skipBackgroundWhenActive?: boolean;
}

type HandlerMap = { [K in PushType]?: PushHandler<Extract<PushPayload, { type: K }>> };

const builtIns: HandlerMap = {
  message: {
    foreground: (p, ctx) => {
      if (ctx.appActive && ctx.activeConversationId === p.conversation_id)
        return { kind: 'suppress' };
      return {
        kind: 'toast',
        conversationId: p.conversation_id,
        title: p.sender_name || 'New message',
        body: p.preview || 'New message',
        toastKind: 'message',
      };
    },
    routeOnTap: (p) => `/chat/${p.conversation_id}`,
  },
  ping: {
    // The WebSocket `ping.received` already plays the full-screen wave in the foreground.
    foreground: () => ({ kind: 'suppress' }),
    routeOnTap: (p) => `/chat/${p.conversation_id}`,
    // Android ping pushes are data-only: the app has to present them itself.
    onBackground: (p) => presentPingNotification(p.conversation_id, p.sender_name),
  },
};

const extensions: HandlerMap = {};

export function registerPushHandler<K extends PushType>(
  type: K,
  handler: PushHandler<Extract<PushPayload, { type: K }>>,
): () => void {
  (extensions as Record<string, unknown>)[type] = handler;
  return () => {
    delete (extensions as Record<string, unknown>)[type];
  };
}

export function getPushHandler<P extends PushPayload>(payload: P): PushHandler<P> | undefined {
  const type = payload.type as PushType;
  return ((extensions as Record<string, unknown>)[type] ??
    (builtIns as Record<string, unknown>)[type]) as PushHandler<P> | undefined;
}

/** Foreground decision for any payload; unknown types fall back to the OS default. */
export function decideForegroundPresentation(
  payload: PushPayload | null,
  ctx: ForegroundContext,
): ForegroundDecision {
  if (!payload) return { kind: 'system' };
  const handler = getPushHandler(payload);
  return handler?.foreground ? handler.foreground(payload, ctx) : { kind: 'system' };
}

export function routeForPayload(payload: PushPayload | null): string | null {
  if (!payload) return null;
  return getPushHandler(payload)?.routeOnTap?.(payload) ?? null;
}
