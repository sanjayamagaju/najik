import { RTCAudioSession, RTCPeerConnection } from 'react-native-webrtc';

import type { PeerConnectionFactory, PeerConnectionLike } from './types';

/** Runtime binding of the engine's PeerConnection interface to react-native-webrtc. */
export const createPeerConnection: PeerConnectionFactory = (config) =>
  new RTCPeerConnection(
    config as ConstructorParameters<typeof RTCPeerConnection>[0],
  ) as unknown as PeerConnectionLike;

/** iOS CallKit hands us an activated AVAudioSession; WebRTC must be told (no-op elsewhere). */
export function notifyAudioSessionActivated(): void {
  try {
    RTCAudioSession.audioSessionDidActivate();
  } catch {
    // not iOS / module missing
  }
}

export function notifyAudioSessionDeactivated(): void {
  try {
    RTCAudioSession.audioSessionDidDeactivate();
  } catch {
    // not iOS / module missing
  }
}
