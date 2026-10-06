import { registerPlugin } from '@capacitor/core';
import { isNative } from './config';

/** Native plugin implemented in android/app/src/main/java/com/najik/app/CallAudioPlugin.java */
interface CallAudioPlugin {
  start(options: { speaker: boolean }): Promise<void>;
  setSpeaker(options: { on: boolean }): Promise<void>;
  stop(): Promise<void>;
}

const CallAudio = registerPlugin<CallAudioPlugin>('CallAudio');

/** Audio routing is only controllable on the native app; the web no-ops. */
export const callAudio = {
  supported: isNative,
  start: (speaker: boolean) => (isNative ? CallAudio.start({ speaker }).catch(() => {}) : Promise.resolve()),
  setSpeaker: (on: boolean) => (isNative ? CallAudio.setSpeaker({ on }).catch(() => {}) : Promise.resolve()),
  stop: () => (isNative ? CallAudio.stop().catch(() => {}) : Promise.resolve()),
};
