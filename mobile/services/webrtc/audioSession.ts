import InCallManager from 'react-native-incall-manager';

import type { CallMedia } from '@/types/protocol';

/**
 * Audio routing + call sounds via react-native-incall-manager (legacy bridge module, runs
 * through the New Architecture interop layer). Every call is guarded: a missing native module
 * (Expo Go, tests) must never break a call.
 *
 * - `start` puts the OS in communication mode: earpiece for audio calls (with the proximity
 *   sensor turning the screen off), speaker for video; wired/Bluetooth headsets take over
 *   automatically.
 */

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // native module unavailable
  }
}

let active = false;

export const audioSession = {
  start(media: CallMedia): void {
    if (active) return;
    active = true;
    safe(() => InCallManager.start({ media, auto: true }));
  },
  /** Outgoing call: the remote device is ringing. */
  startRingback(): void {
    safe(() => InCallManager.startRingback('_DTMF_'));
  },
  stopRingback(): void {
    safe(() => InCallManager.stopRingback());
  },
  stop(): void {
    if (!active) return;
    active = false;
    safe(() => InCallManager.stop());
  },
  setSpeaker(on: boolean): void {
    safe(() => InCallManager.setForceSpeakerphoneOn(on));
  },
  /** Foreground incoming call: system ringtone + vibration (stops itself after `seconds`). */
  startRingtone(seconds = 45): void {
    safe(() => InCallManager.startRingtone('_DEFAULT_', [0, 900, 700], 'playback', seconds));
  },
  stopRingtone(): void {
    safe(() => InCallManager.stopRingtone());
  },
};
