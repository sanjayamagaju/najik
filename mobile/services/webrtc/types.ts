/**
 * The slice of the WebRTC API the engine uses. `react-native-webrtc` satisfies it at runtime;
 * tests provide fakes. Keeping the engine typed against this (not the library classes) is what
 * makes signaling order and quality application unit-testable.
 */

export interface SessionDescriptionInit {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp: string;
}

export interface IceCandidateInit {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
}

export interface MediaTrackLike {
  readonly id: string;
  readonly kind: string;
  enabled: boolean;
  readonly readyState?: string;
  stop(): void;
  getSettings?(): { width?: number; height?: number; frameRate?: number; facingMode?: string };
  applyConstraints?(constraints: Record<string, unknown>): Promise<void>;
}

export interface MediaStreamLike {
  readonly id: string;
  getTracks(): MediaTrackLike[];
  getAudioTracks(): MediaTrackLike[];
  getVideoTracks(): MediaTrackLike[];
  toURL?(): string;
  release?(releaseTracks?: boolean): void;
}

export interface EncodingParamsLike {
  active?: boolean;
  maxBitrate?: number | null;
  maxFramerate?: number | null;
  scaleResolutionDownBy?: number | null;
  [key: string]: unknown;
}

export interface SendParametersLike {
  encodings: EncodingParamsLike[];
  degradationPreference?: string | null;
  [key: string]: unknown;
}

export interface RtpSenderLike {
  readonly track: MediaTrackLike | null;
  getParameters(): SendParametersLike;
  setParameters(params: SendParametersLike): Promise<void>;
  replaceTrack?(track: MediaTrackLike | null): Promise<void>;
}

export interface TrackEventLike {
  track: MediaTrackLike;
  streams: MediaStreamLike[];
}

export interface IceCandidateEventLike {
  candidate: (IceCandidateInit & { toJSON?: () => IceCandidateInit }) | null;
}

export interface PeerConnectionLike {
  readonly signalingState: string;
  readonly iceConnectionState: string;
  readonly connectionState: string;
  readonly remoteDescription: SessionDescriptionInit | null;
  addTrack(track: MediaTrackLike, ...streams: MediaStreamLike[]): RtpSenderLike;
  getSenders(): RtpSenderLike[];
  createOffer(options?: { iceRestart?: boolean }): Promise<SessionDescriptionInit>;
  createAnswer(): Promise<SessionDescriptionInit>;
  setLocalDescription(desc: SessionDescriptionInit): Promise<void>;
  setRemoteDescription(desc: SessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: IceCandidateInit): Promise<void>;
  setConfiguration?(config: Record<string, unknown>): void;
  getStats(): Promise<unknown>;
  close(): void;
  addEventListener(type: string, listener: (event: never) => void): void;
  removeEventListener?(type: string, listener: (event: never) => void): void;
}

export type PeerConnectionFactory = (config: {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
  bundlePolicy?: string;
  rtcpMuxPolicy?: string;
  iceCandidatePoolSize?: number;
}) => PeerConnectionLike;
