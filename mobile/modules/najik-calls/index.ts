import { requireOptionalNativeModule } from 'expo';

export interface EventSubscription {
  remove(): void;
}

/**
 * JS surface of the local `najik-calls` Expo module (see README.md next to this file).
 * The module is optional at runtime: in Jest, Expo Go or a stale dev client it resolves to null
 * and every call becomes a no-op, so the app degrades to in-app incoming-call UI.
 */

export interface IncomingCallPayload {
  call_id: string;
  caller_id: string;
  caller_name: string;
  media: 'audio' | 'video';
  expires_at: string;
}

export type NativeCallAction = 'answer' | 'decline' | 'end' | 'mute' | 'unmute' | 'show';

export interface NativeCallActionEvent {
  action: NativeCallAction;
  callId: string;
  /** Present for actions that originate from an incoming-call push/notification. */
  callerId?: string;
  callerName?: string;
  media?: string;
  expiresAt?: string;
}

export interface NajikCallsEvents {
  onVoipToken: (event: { token: string }) => void;
  /** iOS: a VoIP push was received and reported to CallKit. */
  onIncomingPush: (event: IncomingCallPayload) => void;
  onCallAction: (event: NativeCallActionEvent) => void;
  /** iOS: CallKit (de)activated the AVAudioSession. */
  onAudioSession: (event: { active: boolean }) => void;
}

export interface NajikCallsNativeModule {
  // iOS (no-ops on Android)
  registerVoip(): void;
  getVoipToken(): string | null;
  reportIncomingCall(callId: string, callerName: string, hasVideo: boolean): Promise<boolean>;
  reportOutgoingCall(callId: string, handle: string, hasVideo: boolean): void;
  reportOutgoingConnected(callId: string): void;
  answerCall(callId: string): void;
  endCall(callId: string): void;
  reportCallEnded(callId: string, reason: string): void;
  setMuted(callId: string, muted: boolean): void;
  // Android (no-ops on iOS)
  ensureCallChannel(): void;
  showIncomingCall(
    callId: string,
    callerId: string,
    callerName: string,
    media: string,
    expiresAt: string,
  ): void;
  dismissIncomingCall(callId: string): void;
  startOngoingCall(callId: string, peerName: string, video: boolean): void;
  stopOngoingCall(): void;
  canUseFullScreenIntent(): boolean;
  openFullScreenIntentSettings(): void;
  setShowWhenLocked(show: boolean): void;
  // both
  consumePendingActions(): NativeCallActionEvent[];
  addListener<K extends keyof NajikCallsEvents>(
    eventName: K,
    listener: NajikCallsEvents[K],
  ): EventSubscription;
}

export const NajikCalls = requireOptionalNativeModule<NajikCallsNativeModule>('NajikCalls');
