import { Platform } from 'react-native';

import {
  type IncomingCallPayload,
  NajikCalls,
  type NajikCallsNativeModule,
  type NativeCallActionEvent,
} from '@/modules/najik-calls';
import { telemetry } from '@/services/telemetry';

/**
 * Platform-neutral facade over the local `najik-calls` module (CallKit/PushKit on iOS,
 * full-screen notification + foreground service on Android). Every method is a safe no-op when
 * the native module is missing, so the in-app call UI keeps working everywhere.
 */
export interface CallNativeBridge {
  readonly available: boolean;
  /** iOS: CallKit owns ringing + the system incoming UI (no in-app ringtone needed). */
  readonly systemRingsIncoming: boolean;
  registerVoip(): void;
  getVoipToken(): string | null;
  reportIncoming(callId: string, callerName: string, video: boolean): Promise<boolean>;
  reportOutgoing(callId: string, peerName: string, video: boolean): void;
  reportConnected(callId: string): void;
  answer(callId: string): void;
  end(callId: string): void;
  reportEnded(callId: string, reason: string): void;
  setMuted(callId: string, muted: boolean): void;
  ensureChannel(): void;
  showIncoming(payload: IncomingCallPayload): void;
  dismissIncoming(callId: string): void;
  startOngoing(callId: string, peerName: string, video: boolean): void;
  stopOngoing(): void;
  canUseFullScreenIntent(): boolean;
  openFullScreenIntentSettings(): void;
  setShowWhenLocked(show: boolean): void;
  consumePendingActions(): NativeCallActionEvent[];
  onAction(listener: (event: NativeCallActionEvent) => void): () => void;
  onIncomingPush(listener: (payload: IncomingCallPayload) => void): () => void;
  onVoipToken(listener: (token: string) => void): () => void;
  onAudioSession(listener: (active: boolean) => void): () => void;
}

function guard<T>(name: string, fallback: T, fn: (m: NajikCallsNativeModule) => T): T {
  if (!NajikCalls) return fallback;
  try {
    return fn(NajikCalls);
  } catch (error) {
    telemetry.warn('calls', `native ${name} failed`, { error: String(error) });
    return fallback;
  }
}

const noop = () => undefined;

export function createCallNativeBridge(): CallNativeBridge {
  const ios = Platform.OS === 'ios';
  const android = Platform.OS === 'android';
  return {
    available: NajikCalls !== null,
    systemRingsIncoming: ios && NajikCalls !== null,
    registerVoip: () => {
      if (ios) guard('registerVoip', undefined, (m) => m.registerVoip());
    },
    getVoipToken: () => (ios ? guard('getVoipToken', null, (m) => m.getVoipToken()) : null),
    reportIncoming: (callId, callerName, video) =>
      ios
        ? guard('reportIncoming', Promise.resolve(false), (m) =>
            m.reportIncomingCall(callId, callerName, video).catch(() => false),
          )
        : Promise.resolve(false),
    reportOutgoing: (callId, peerName, video) => {
      if (ios)
        guard('reportOutgoing', undefined, (m) => m.reportOutgoingCall(callId, peerName, video));
    },
    reportConnected: (callId) => {
      if (ios) guard('reportConnected', undefined, (m) => m.reportOutgoingConnected(callId));
    },
    answer: (callId) => {
      if (ios) guard('answer', undefined, (m) => m.answerCall(callId));
    },
    end: (callId) => {
      if (ios) guard('end', undefined, (m) => m.endCall(callId));
    },
    reportEnded: (callId, reason) => {
      if (ios) guard('reportEnded', undefined, (m) => m.reportCallEnded(callId, reason));
    },
    setMuted: (callId, muted) => {
      if (ios) guard('setMuted', undefined, (m) => m.setMuted(callId, muted));
    },
    ensureChannel: () => {
      if (android) guard('ensureChannel', undefined, (m) => m.ensureCallChannel());
    },
    showIncoming: (p) => {
      if (android)
        guard('showIncoming', undefined, (m) =>
          m.showIncomingCall(p.call_id, p.caller_id, p.caller_name, p.media, p.expires_at),
        );
    },
    dismissIncoming: (callId) => {
      if (android) guard('dismissIncoming', undefined, (m) => m.dismissIncomingCall(callId));
    },
    startOngoing: (callId, peerName, video) => {
      if (android)
        guard('startOngoing', undefined, (m) => m.startOngoingCall(callId, peerName, video));
    },
    stopOngoing: () => {
      if (android) guard('stopOngoing', undefined, (m) => m.stopOngoingCall());
    },
    canUseFullScreenIntent: () =>
      android ? guard('canUseFullScreenIntent', true, (m) => m.canUseFullScreenIntent()) : true,
    openFullScreenIntentSettings: () => {
      if (android) guard('openFsiSettings', undefined, (m) => m.openFullScreenIntentSettings());
    },
    setShowWhenLocked: (show) => {
      if (android) guard('setShowWhenLocked', undefined, (m) => m.setShowWhenLocked(show));
    },
    consumePendingActions: () => guard('consumePending', [], (m) => m.consumePendingActions()),
    onAction: (listener) =>
      guard('onAction', noop, (m) => {
        const sub = m.addListener('onCallAction', listener);
        return () => sub.remove();
      }),
    onIncomingPush: (listener) =>
      guard('onIncomingPush', noop, (m) => {
        const sub = m.addListener('onIncomingPush', listener);
        return () => sub.remove();
      }),
    onVoipToken: (listener) =>
      guard('onVoipToken', noop, (m) => {
        const sub = m.addListener('onVoipToken', (e) => listener(e.token));
        return () => sub.remove();
      }),
    onAudioSession: (listener) =>
      guard('onAudioSession', noop, (m) => {
        const sub = m.addListener('onAudioSession', (e) => listener(e.active));
        return () => sub.remove();
      }),
  };
}

/** No-op bridge (tests / platforms without the module). */
export const nullCallNativeBridge: CallNativeBridge = {
  available: false,
  systemRingsIncoming: false,
  registerVoip: noop,
  getVoipToken: () => null,
  reportIncoming: () => Promise.resolve(false),
  reportOutgoing: noop,
  reportConnected: noop,
  answer: noop,
  end: noop,
  reportEnded: noop,
  setMuted: noop,
  ensureChannel: noop,
  showIncoming: noop,
  dismissIncoming: noop,
  startOngoing: noop,
  stopOngoing: noop,
  canUseFullScreenIntent: () => true,
  openFullScreenIntentSettings: noop,
  setShowWhenLocked: noop,
  consumePendingActions: () => [],
  onAction: () => noop,
  onIncomingPush: () => noop,
  onVoipToken: () => noop,
  onAudioSession: () => noop,
};
