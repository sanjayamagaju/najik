import { createStore, type StoreApi, useStore } from 'zustand';

import type { QualityDecision } from '@/services/webrtc/quality/QualityController';
import type { NormalizedStats } from '@/services/webrtc/stats/normalizeStats';
import type { AudioQualityPref, VideoQualityPref } from '@/types/protocol';

import { type CallMachineState, initialCallState } from '../model/callMachine';

export type CameraFacing = 'user' | 'environment';

/** Everything the call UI renders. Written only by the CallController. */
export interface CallStoreState {
  machine: CallMachineState;
  micMuted: boolean;
  speakerOn: boolean;
  cameraOn: boolean;
  facing: CameraFacing;
  remoteAudioMuted: boolean;
  remoteVideoEnabled: boolean;
  localStreamUrl: string | null;
  remoteStreamUrl: string | null;
  iceState: string | null;
  stats: NormalizedStats | null;
  networkLevel: 0 | 1 | 2 | 3 | 4;
  /** What I want to RECEIVE (YouTube semantics) — sent to the peer as a `quality` signal. */
  videoPref: VideoQualityPref;
  audioPref: AudioQualityPref;
  /** What my sender is currently doing (after the peer's caps and my uplink Auto). */
  sendDecision: QualityDecision | null;
  /** Native incoming-call UI (CallKit / full-screen notification) is ringing for this call. */
  nativeRinging: boolean;
  /** The full call screen is mounted (the global incoming overlay hides itself then). */
  screenOpen: boolean;
}

export const initialCallStoreState: CallStoreState = {
  machine: initialCallState,
  micMuted: false,
  speakerOn: false,
  cameraOn: false,
  facing: 'user',
  remoteAudioMuted: false,
  remoteVideoEnabled: true,
  localStreamUrl: null,
  remoteStreamUrl: null,
  iceState: null,
  stats: null,
  networkLevel: 4,
  videoPref: 'auto',
  audioPref: 'auto',
  sendDecision: null,
  nativeRinging: false,
  screenOpen: false,
};

export type CallStore = StoreApi<CallStoreState>;

export function createCallStore(): CallStore {
  return createStore<CallStoreState>()(() => ({ ...initialCallStoreState }));
}

/** The app-wide call store (tests create their own with `createCallStore`). */
export const callStore: CallStore = createCallStore();

export function useCallStore<T>(selector: (state: CallStoreState) => T): T {
  return useStore(callStore, selector);
}
