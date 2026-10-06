import { create } from 'zustand';
import { api } from '../lib/api';
import { emit, emitAck } from '../lib/socket';
import { haptic, keepAwake } from '../lib/native';
import { callAudio } from '../lib/callAudio';
import { isNative } from '../lib/config';
import { releaseLockScreen, type CallAction } from '../lib/push';
import { sounds, startRingback, startRingtone } from '../lib/sounds';
import { toast } from './toast';
import { CallSession, type LinkState, type SendingInfo, type SignalPayload } from '../webrtc/CallSession';
import { countCameras, getLocalMedia, stopStream } from '../webrtc/media';
import type { AudioPref, VideoLevelId, VideoPref } from '../webrtc/quality';
import type { CallStats } from '../webrtc/stats';
import type { CallMedia, User } from '../types';

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

interface CallState {
  phase: CallPhase;
  callId: string | null;
  role: 'caller' | 'callee' | null;
  peer: User | null;
  media: CallMedia;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  /** Bumped whenever remote tracks change (the stream object itself stays the same). */
  remoteVersion: number;
  link: LinkState;
  signalingLost: boolean;
  /** Outgoing: the callee's device has the call (vs. still being woken by push). */
  ringing: boolean;
  micOn: boolean;
  camOn: boolean;
  speakerOn: boolean;
  facing: 'user' | 'environment';
  canSwitchCamera: boolean;
  peerMic: boolean;
  peerCam: boolean;
  videoPref: VideoPref;
  audioPref: AudioPref;
  localSending: SendingInfo | null;
  peerSending: SendingInfo | null;
  peerMaxVideo: VideoLevelId | null;
  stats: CallStats | null;
  startedAt: number | null;
  endedLabel: string | null;
  minimized: boolean;

  startCall: (peer: User, media: CallMedia) => Promise<void>;
  accept: () => Promise<void>;
  decline: () => void;
  hangup: () => void;
  toggleMic: () => void;
  toggleCam: () => void;
  toggleSpeaker: () => void;
  switchCamera: () => Promise<void>;
  setVideoPref: (p: VideoPref) => void;
  setAudioPref: (p: AudioPref) => void;
  setMinimized: (m: boolean) => void;

  // socket-driven
  onIncoming: (p: { callId: string; from: User; media: CallMedia }) => void;
  onRinging: (p: { callId: string }) => void;
  /** Tap / Answer on the Android incoming-call notification. */
  handleCallAction: (a: CallAction) => void;
  onAccepted: (p: { callId: string }) => void;
  onSignal: (p: { callId: string; payload: SignalPayload }) => void;
  onEnded: (p: { callId: string; reason: string }) => void;
  onPeerSignaling: (p: { callId: string }, lost: boolean) => void;
  onSocketReconnect: () => void;
}

let session: CallSession | null = null;
let stopTone: (() => void) | null = null;
let iceCache: { servers: RTCIceServer[]; until: number } | null = null;
let endTimer: number | null = null;
/** Incremented per call attempt so a stale async step of an earlier attempt can't touch a newer call. */
let attempt = 0;
/** ICE servers fetched while ringing, used once the callee accepts. */
let pendingServers: RTCIceServer[] | null = null;
/** A notification action that arrived before the call itself reached the app. */
let pendingAction: (CallAction & { at: number }) | null = null;
const PENDING_ACTION_MAX_AGE_MS = 60_000;

/** When the app is backgrounded on Android, the push notification rings instead. */
const ringsInBackground = () => isNative && document.visibilityState === 'hidden';

async function iceServers(): Promise<RTCIceServer[]> {
  if (iceCache && iceCache.until > Date.now()) return iceCache.servers;
  try {
    const res = await api<{ iceServers: RTCIceServer[]; ttl: number }>('/rtc/ice');
    iceCache = { servers: res.iceServers, until: Date.now() + (res.ttl * 1000) / 2 };
    return res.iceServers;
  } catch {
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }
}

function tone(fn: (() => () => void) | null): void {
  stopTone?.();
  stopTone = fn ? fn() : null;
  haptic.ring(false);
}

const END_LABELS: Record<string, string> = {
  completed: 'Call ended',
  declined: 'Call declined',
  missed: 'No answer',
  cancelled: 'Call cancelled',
  failed: 'Connection lost',
  'answered-elsewhere': 'Answered on another device',
};

const initial = {
  phase: 'idle' as CallPhase,
  callId: null,
  role: null,
  peer: null,
  media: 'audio' as CallMedia,
  localStream: null,
  remoteStream: null,
  remoteVersion: 0,
  link: 'connecting' as LinkState,
  signalingLost: false,
  ringing: false,
  micOn: true,
  camOn: true,
  speakerOn: false,
  facing: 'user' as const,
  canSwitchCamera: false,
  peerMic: true,
  peerCam: true,
  localSending: null,
  peerSending: null,
  peerMaxVideo: null,
  stats: null,
  startedAt: null,
  endedLabel: null,
  minimized: false,
};

export const useCall = create<CallState>((set, get) => {
  const createSession = (role: 'caller' | 'callee', localStream: MediaStream, servers: RTCIceServer[]) => {
    const callId = get().callId!;
    session = new CallSession({
      role,
      iceServers: servers,
      localStream,
      signal: (payload) => emit('call:signal', { callId, payload }),
      events: {
        remoteStream: (remoteStream) => set({ remoteStream, remoteVersion: get().remoteVersion + 1 }),
        localStream: (s) => set({ localStream: s }),
        link: (link) => {
          if (link === 'failed') return finish('failed', true);
          set({ link });
          if (link === 'connected' && get().phase === 'connecting') {
            set({ phase: 'active', startedAt: Date.now() });
            sounds.connected();
            haptic.success();
          }
        },
        stats: (stats) => set({ stats }),
        localSending: (localSending) => set({ localSending }),
        peerSending: (peerSending) => set({ peerSending }),
        peerCaps: (peerMaxVideo) => set({ peerMaxVideo }),
        peerMedia: ({ mic, cam }) => set({ peerMic: mic, peerCam: cam }),
      },
    });
    session.setReceivePrefs(get().videoPref, get().audioPref);
    // Apply mute / camera-off chosen while ringing so the peer sees the right state.
    session.setMicEnabled(get().micOn);
    if (localStream.getVideoTracks().length) session.setCamEnabled(get().camOn);
  };

  /** Tear everything down and show a short "ended" state. */
  const finish = (reason: string, notifyServer = false) => {
    const { callId, phase } = get();
    if (phase === 'idle' || phase === 'ended') return;
    if (notifyServer && callId) emit('call:end', { callId });
    tone(null);
    session?.close();
    session = null;
    stopStream(get().localStream);
    void callAudio.stop();
    void keepAwake(false);
    releaseLockScreen();
    if (phase !== 'incoming' || reason !== 'answered-elsewhere') sounds.callEnd();
    set({ phase: 'ended', endedLabel: END_LABELS[reason] ?? reason, localStream: null, remoteStream: null, minimized: false });
    if (endTimer) window.clearTimeout(endTimer);
    endTimer = window.setTimeout(() => {
      if (get().phase === 'ended') set({ ...initial, videoPref: get().videoPref, audioPref: get().audioPref });
    }, 1600);
  };

  /** Acquire mic/camera + ICE config. Returns null if the call was abandoned meanwhile. */
  const prepareLocal = async (media: CallMedia, isCurrent: () => boolean) => {
    const [{ stream, videoFailed }, servers] = await Promise.all([getLocalMedia(media), iceServers()]);
    if (!isCurrent()) {
      stopStream(stream);
      return null;
    }
    // Counted after permission is granted: before that, browsers expose at most one camera.
    const cams = await countCameras();
    if (videoFailed) toast.info('Camera unavailable', 'Continuing with audio only.');
    // Video calls default to the loudspeaker, voice calls to the earpiece.
    const speakerOn = media === 'video';
    void callAudio.start(speakerOn);
    set({
      speakerOn,
      localStream: stream,
      camOn: stream.getVideoTracks().length > 0,
      canSwitchCamera: cams > 1 && stream.getVideoTracks().length > 0,
    });
    return { stream, servers };
  };

  return {
    ...initial,
    videoPref: (localStorage.getItem('najik.videoPref') as VideoPref) || 'auto',
    audioPref: (localStorage.getItem('najik.audioPref') as AudioPref) || 'auto',

    async startCall(peer, media) {
      if (get().phase !== 'idle' && get().phase !== 'ended') return;
      if (endTimer) window.clearTimeout(endTimer);
      const mine = ++attempt;
      const isCurrent = () => attempt === mine && get().phase === 'outgoing';
      set({ ...initial, videoPref: get().videoPref, audioPref: get().audioPref, phase: 'outgoing', role: 'caller', peer, media });
      void keepAwake(true);
      let local: { stream: MediaStream; servers: RTCIceServer[] } | null;
      try {
        local = await prepareLocal(media, isCurrent);
      } catch (err) {
        if (!isCurrent()) return;
        toast.error('Call failed', (err as Error).message);
        set({ ...initial, videoPref: get().videoPref, audioPref: get().audioPref });
        void keepAwake(false);
        return;
      }
      if (!local) return; // cancelled (or redialled) while acquiring media
      try {
        const { callId } = await emitAck<{ callId: string }>('call:invite', { to: peer.id, media });
        if (!isCurrent()) {
          emit('call:end', { callId }); // hung up while the invite was in flight
          return;
        }
        set({ callId });
        tone(startRingback);
        pendingServers = local.servers;
      } catch (err) {
        if (isCurrent()) finish((err as Error).message);
      }
    },

    async accept() {
      const { phase, media } = get();
      if (phase !== 'incoming') return;
      tone(null);
      const mine = ++attempt;
      set({ phase: 'connecting' });
      void keepAwake(true);
      try {
        const local = await prepareLocal(media, () => attempt === mine && get().phase === 'connecting');
        if (!local) return;
        createSession('callee', local.stream, local.servers);
        await emitAck('call:accept', { callId: get().callId });
      } catch (err) {
        toast.error("Couldn't answer", (err as Error).message);
        finish('failed', true);
      }
    },

    decline() {
      const { callId, phase } = get();
      if (phase !== 'incoming' || !callId) return;
      emit('call:reject', { callId });
      finish('declined');
    },

    hangup() {
      const { phase } = get();
      if (phase === 'idle' || phase === 'ended') return;
      haptic.medium();
      finish(phase === 'outgoing' ? 'cancelled' : 'completed', true);
    },

    toggleMic() {
      const micOn = !get().micOn;
      session?.setMicEnabled(micOn);
      if (!session) get().localStream?.getAudioTracks().forEach((t) => (t.enabled = micOn));
      set({ micOn });
      haptic.tap();
    },

    toggleCam() {
      if (!get().localStream?.getVideoTracks().length) return;
      const camOn = !get().camOn;
      session?.setCamEnabled(camOn);
      if (!session) get().localStream?.getVideoTracks().forEach((t) => (t.enabled = camOn));
      set({ camOn });
      haptic.tap();
    },

    toggleSpeaker() {
      const speakerOn = !get().speakerOn;
      void callAudio.setSpeaker(speakerOn);
      set({ speakerOn });
      haptic.tap();
    },

    async switchCamera() {
      if (!session) return;
      haptic.tap();
      try {
        await session.switchCamera();
        set({ facing: session.facingMode });
      } catch {
        toast.error('Could not switch camera');
      }
    },

    setVideoPref(videoPref) {
      localStorage.setItem('najik.videoPref', videoPref);
      set({ videoPref });
      session?.setReceivePrefs(videoPref, get().audioPref);
    },

    setAudioPref(audioPref) {
      localStorage.setItem('najik.audioPref', audioPref);
      set({ audioPref });
      session?.setReceivePrefs(get().videoPref, audioPref);
    },

    setMinimized(minimized) {
      set({ minimized });
    },

    onIncoming({ callId, from, media }) {
      const { phase } = get();
      // Re-delivery of the call we're already showing (e.g. after a reconnect).
      if (callId === get().callId && phase !== 'ended') return;
      if (phase !== 'idle' && phase !== 'ended') {
        emit('call:reject', { callId });
        return;
      }
      if (endTimer) window.clearTimeout(endTimer);
      set({ ...initial, videoPref: get().videoPref, audioPref: get().audioPref, phase: 'incoming', callId, role: 'callee', peer: from, media });

      const action = pendingAction;
      pendingAction = null;
      if (action && action.callId === callId && Date.now() - action.at < PENDING_ACTION_MAX_AGE_MS && action.action === 'accept') {
        void get().accept(); // "Answer" was tapped on the notification
        return;
      }
      if (!ringsInBackground()) {
        tone(startRingtone);
        haptic.ring(true);
      }
    },

    onRinging({ callId }) {
      if (get().callId === callId) set({ ringing: true });
    },

    handleCallAction(a) {
      const { phase, callId } = get();
      if (phase === 'incoming' && callId === a.callId) {
        if (a.action === 'accept') void get().accept();
        else if (!stopTone) {
          tone(startRingtone);
          haptic.ring(true);
        }
        return;
      }
      // The socket hasn't delivered the call yet (cold start) — remember the intent.
      pendingAction = { ...a, at: Date.now() };
    },

    onAccepted({ callId }) {
      const s = get();
      if (s.callId !== callId || s.phase !== 'outgoing' || !s.localStream) return;
      tone(null);
      set({ phase: 'connecting' });
      createSession('caller', s.localStream, pendingServers ?? []);
      void session!.negotiate().catch(() => finish('failed', true));
    },

    onSignal({ callId, payload }) {
      if (get().callId !== callId || !session) return;
      void session.handleSignal(payload).catch((err) => console.warn('[najik] signal error', err));
    },

    onEnded({ callId, reason }) {
      if (get().callId !== callId) return;
      finish(reason);
    },

    onPeerSignaling({ callId }, lost) {
      if (get().callId === callId) set({ signalingLost: lost });
    },

    onSocketReconnect() {
      const { callId, phase } = get();
      if (!callId || phase === 'idle' || phase === 'ended') return;
      emitAck('call:rejoin', { callId })
        .then(() => session?.kick())
        .catch((err: Error) => finish(err.message === 'answered-elsewhere' ? 'answered-elsewhere' : 'failed'));
    },
  };
});


// Coming back to the foreground while a call is ringing: ring in-app.
document.addEventListener('visibilitychange', () => {
  const { phase } = useCall.getState();
  if (document.visibilityState === 'visible' && phase === 'incoming' && !stopTone) {
    tone(startRingtone);
    haptic.ring(true);
  }
});
