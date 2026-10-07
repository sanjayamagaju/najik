import type { IncomingCallPayload, NativeCallActionEvent } from '@/modules/najik-calls';
import { PeerSession, type Timers } from '@/services/webrtc/PeerSession';
import { IceServerStore } from '@/services/webrtc/iceServers';
import { type VideoTier, tierForHeight } from '@/services/webrtc/quality/ladder';
import {
  QualityController,
  type QualityDecision,
} from '@/services/webrtc/quality/QualityController';
import { MetricsAggregator } from '@/services/webrtc/stats/metricsAggregator';
import {
  networkQualityLevel,
  normalizeStats,
  type StatsCursor,
  toQualitySample,
} from '@/services/webrtc/stats/normalizeStats';
import type {
  MediaStreamLike,
  MediaTrackLike,
  PeerConnectionFactory,
} from '@/services/webrtc/types';
import type { WsClient } from '@/services/websocket/WsClient';
import type {
  AudioQualityPref,
  Call,
  CallEndReason,
  CallMedia,
  CallMetricsBody,
  CallSignal,
  IceServer,
  IceServers,
  PublicUser,
  VideoQualityPref,
} from '@/types/protocol';

import type { CallNativeBridge } from '../native/callNative';
import {
  type CallEndKind,
  type CallEvent,
  type CallPeer,
  callDurationSec,
  isLive,
  localHangupOutcome,
  transition,
} from '../model/callMachine';
import { type CallStore, type CameraFacing, initialCallStoreState } from '../store/callStore';

/**
 * Orchestrates one call at a time: WS signaling (PROTOCOL §4.2–4.4), the PeerSession, local
 * media, adaptive quality, native call UX, metrics and the call store. Everything with a side
 * effect is injected so the ordering rules are unit-testable:
 *
 *  - The caller creates its PeerConnection and sends the offer **only after `call.accepted`**
 *    (the server relays `call.signal` only while the call is active).
 *  - The callee buffers signals that race ahead of its accept ack and replays them in order.
 *  - After a WebSocket reconnect inside the server's 30 s grace window the call survives, so
 *    the client verifies the call is still live and performs an ICE restart.
 */

export type WsLike = Pick<
  WsClient,
  'request' | 'send' | 'isOpen' | 'on' | 'onAuthenticated' | 'onStateChange'
>;

export interface CallMediaDeps {
  ensurePermissions(media: CallMedia): Promise<boolean>;
  acquire(
    media: CallMedia,
    options: { facing: CameraFacing; maxTier: VideoTier },
  ): Promise<MediaStreamLike>;
  stop(stream: MediaStreamLike | null): void;
  switchCamera(track: MediaTrackLike, current: CameraFacing): Promise<CameraFacing>;
  captureHeight(track: MediaTrackLike | null | undefined): number | null;
}

export interface CallAudioDeps {
  start(media: CallMedia): void;
  startRingback(): void;
  stopRingback(): void;
  stop(): void;
  setSpeaker(on: boolean): void;
  startRingtone(seconds?: number): void;
  stopRingtone(): void;
}

export interface CallApiDeps {
  iceServers(): Promise<IceServers>;
  getCall(id: string): Promise<Call>;
  postMetrics(id: string, body: CallMetricsBody): Promise<void>;
  lookupPeer(id: string): PublicUser | null;
}

export interface CallControllerDeps {
  ws: WsLike;
  api: CallApiDeps;
  media: CallMediaDeps;
  audio: CallAudioDeps;
  native: CallNativeBridge;
  createPeerConnection: PeerConnectionFactory;
  store: CallStore;
  newCallId: () => string;
  myUserId: () => string | null;
  deviceVideoCap: () => VideoTier;
  networkType: () => string;
  timers?: Timers;
  log?: (message: string, data?: Record<string, unknown>) => void;
  breadcrumb?: (message: string, data?: Record<string, unknown>) => void;
  haptic?: (kind: 'connected' | 'ended' | 'tap') => void;
  /** AppState is `active` (used to pick in-app vs notification ringing on Android). */
  isAppActive?: () => boolean;
  /** Called whenever the iOS CallKit audio session (de)activates (→ RTCAudioSession). */
  onAudioSession?: (active: boolean) => void;
  statsIntervalMs?: number;
  /** Client-side safety net in case the server's ring timeout event is lost. */
  ringSafetyMs?: number;
  /** Max time in connecting/reconnecting before the call is failed. */
  mediaTimeoutMs?: number;
  wsWaitMs?: number;
}

const DEFAULT_AVATAR = '#7B4DFF';

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return 'unknown';
}

function sleep(timers: Timers, ms: number): Promise<void> {
  return new Promise((resolve) => timers.setTimeout(resolve, ms));
}

export class CallController {
  private readonly d: CallControllerDeps;
  private readonly timers: Timers;
  private readonly ice: IceServerStore;

  private sessionId: string | null = null;
  private session: PeerSession | null = null;
  private localStream: MediaStreamLike | null = null;
  private pendingSignals: CallSignal[] = [];
  private quality: QualityController | null = null;
  private metrics = new MetricsAggregator();
  private statsCursor: StatsCursor | null = null;
  private statsTimer: unknown = null;
  private ringTimer: unknown = null;
  private mediaTimer: unknown = null;
  private lastDtxRenegotiationAt = -Infinity;
  private lastNetworkKey: string | null = null;
  private cameraPausedForBackground = false;
  private nativeAnswered = false;
  private installed = false;
  private readonly unsubscribers: (() => void)[] = [];
  /** Calls recently declined as busy / handled, to ignore duplicate pushes for them. */
  private readonly handledIncoming = new Set<string>();

  constructor(deps: CallControllerDeps) {
    this.d = deps;
    this.timers = deps.timers ?? defaultTimers;
    this.ice = new IceServerStore(
      async () => (await deps.api.iceServers()).ice_servers,
      () => this.timers.now(),
    );
  }

  // ───────────────────────── state helpers ─────────────────────────

  private get state() {
    return this.d.store.getState();
  }

  private get machine() {
    return this.state.machine;
  }

  private dispatch(event: CallEvent): void {
    const prev = this.machine;
    const next = transition(prev, event);
    if (next === prev) return;
    this.d.store.setState({ machine: next });
    if (prev.phase !== next.phase) {
      this.d.breadcrumb?.(`call ${prev.phase} → ${next.phase}`, {
        event: event.type,
        ...(next.endReason ? { reason: next.endReason } : {}),
      });
      this.onPhaseChange(prev.phase, next.phase);
    }
  }

  private log(message: string, data?: Record<string, unknown>): void {
    this.d.log?.(message, data);
  }

  // ───────────────────────── wiring ─────────────────────────

  /** Subscribe to WS + native events once per process (subscriptions survive sign-out/in). */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    const ws = this.d.ws;
    this.unsubscribers.push(
      ws.on('call.incoming', ({ call, caller, ice_servers }) =>
        this.onIncoming(call, caller, ice_servers),
      ),
      ws.on('call.ringing', ({ call_id }) =>
        this.dispatch({ type: 'REMOTE_RINGING', callId: call_id }),
      ),
      ws.on('call.accepted', ({ call_id, session_id }) => this.onAccepted(call_id, session_id)),
      ws.on('call.ended', ({ call_id, reason }) => this.onServerEnded(call_id, reason)),
      ws.on('call.signal', ({ call_id, signal }) => void this.onSignal(call_id, signal)),
      ws.on('call.media_state', (e) => {
        if (e.call_id !== this.machine.callId || e.user_id === this.d.myUserId()) return;
        this.d.store.setState({
          remoteAudioMuted: e.audio_muted,
          remoteVideoEnabled: e.video_enabled,
        });
      }),
      ws.onAuthenticated((ack, { reconnect }) => {
        this.sessionId = ack.session_id;
        if (reconnect) void this.onWsReconnected();
        this.processPendingNativeActions();
      }),
      this.d.native.onAction((event) => this.handleNativeAction(event)),
      this.d.native.onIncomingPush((payload) =>
        this.handleIncomingPush(payload, { nativeRinging: true }),
      ),
      this.d.native.onAudioSession((active) => this.d.onAudioSession?.(active)),
    );
  }

  dispose(): void {
    for (const off of this.unsubscribers.splice(0)) off();
    this.installed = false;
  }

  // ───────────────────────── outgoing ─────────────────────────

  async startOutgoing(params: {
    peer: CallPeer;
    media: CallMedia;
    conversationId: string | null;
  }): Promise<void> {
    if (isLive(this.machine.phase)) return;
    const callId = this.d.newCallId();
    this.resetUi(params.media);
    this.dispatch({
      type: 'DIAL',
      callId,
      peer: params.peer,
      media: params.media,
      conversationId: params.conversationId,
      at: this.timers.now(),
    });

    if (!(await this.prepareLocalMedia(params.media, callId))) return;
    if (!this.isCurrent(callId, ['outgoing'])) return;

    if (!(await this.waitForSocket())) {
      this.fail(callId, 'offline');
      return;
    }
    if (!this.isCurrent(callId, ['outgoing'])) return;

    this.d.native.reportOutgoing(callId, params.peer.display_name, params.media === 'video');
    try {
      const ack = await this.d.ws.request('call.invite', {
        call_id: callId,
        callee_id: params.peer.id,
        media: params.media,
      });
      this.ice.set(ack.ice_servers);
      this.dispatch({ type: 'INVITE_ACKED', call: ack.call, at: this.timers.now() });
      if (this.isCurrent(callId, ['outgoing', 'ringing'])) this.armRingSafety(callId);
    } catch (error) {
      const code = errorCode(error);
      this.log('invite failed', { code });
      if (!this.isCurrent(callId, ['outgoing'])) return;
      const reason: CallEndKind =
        code === 'busy'
          ? 'in_another_call'
          : code === 'rate_limited'
            ? 'rate_limited'
            : code === 'not_connected' || code === 'disconnected'
              ? 'offline'
              : 'error';
      this.dispatch({ type: 'INVITE_FAILED', reason, at: this.timers.now() });
    }
  }

  private onAccepted(callId: string, sessionId: string): void {
    const m = this.machine;
    if (m.callId !== callId) return;
    if (m.direction === 'outgoing') {
      this.dispatch({ type: 'REMOTE_ACCEPTED', callId });
      if (!this.isCurrent(callId, ['connecting'])) return;
      this.clearRingSafety();
      this.d.audio.stopRingback();
      this.createSession('caller');
      void this.session?.startOffer();
      return;
    }
    // Callee: another of my devices answered.
    if (m.phase === 'incoming' && this.sessionId !== null && sessionId !== this.sessionId) {
      this.dispatch({
        type: 'SERVER_ENDED',
        callId,
        reason: 'answered_elsewhere',
        at: this.timers.now(),
      });
    }
  }

  // ───────────────────────── incoming ─────────────────────────

  private onIncoming(call: Call, caller: PublicUser, iceServers: IceServer[]): void {
    const me = this.d.myUserId();
    if (me && call.callee_id !== me) return;
    if (call.state === 'ended') return;
    if (this.machine.callId === call.id) {
      // Already known from a push: enrich with the full profile + ICE servers.
      this.ice.set(iceServers);
      if (this.machine.peer && this.machine.phase === 'incoming') {
        this.d.store.setState({
          machine: { ...this.machine, peer: toPeer(caller) },
        });
      }
      return;
    }
    if (this.declineIfBusy(call.id)) return;
    this.ice.set(iceServers);
    this.beginIncoming(call.id, toPeer(caller), call.media, { nativeRinging: false });
  }

  /** A `call.incoming` push (FCM in foreground, iOS VoIP via CallKit, Android notification). */
  handleIncomingPush(payload: IncomingCallPayload, options: { nativeRinging: boolean }): void {
    const expires = Date.parse(payload.expires_at);
    if (Number.isFinite(expires) && expires <= this.timers.now()) return;
    if (this.machine.callId === payload.call_id || this.handledIncoming.has(payload.call_id)) {
      if (options.nativeRinging && this.machine.callId === payload.call_id) {
        this.d.store.setState({ nativeRinging: true });
        this.d.audio.stopRingtone();
      }
      return;
    }
    if (this.declineIfBusy(payload.call_id)) return;
    const known = this.d.api.lookupPeer(payload.caller_id);
    const peer: CallPeer = known
      ? toPeer(known)
      : {
          id: payload.caller_id,
          display_name: payload.caller_name || 'Najik user',
          avatar_color: DEFAULT_AVATAR,
        };
    this.beginIncoming(payload.call_id, peer, payload.media, options);
    // No `call.incoming` frame is replayed after a reconnect: confirm it is still ringing.
    void this.verifyStillRinging(payload.call_id);
  }

  private beginIncoming(
    callId: string,
    peer: CallPeer,
    media: CallMedia,
    options: { nativeRinging: boolean },
  ): void {
    this.resetUi(media);
    this.dispatch({
      type: 'INCOMING',
      callId,
      peer,
      media,
      conversationId: null,
      at: this.timers.now(),
    });
    if (!this.isCurrent(callId, ['incoming'])) return;
    this.handledIncoming.add(callId);
    this.d.store.setState({ nativeRinging: options.nativeRinging });
    if (this.d.ws.isOpen()) this.d.ws.send('call.ringing', { call_id: callId });
    if (this.d.native.systemRingsIncoming) {
      // iOS: CallKit rings and shows the system UI (required for VoIP pushes anyway).
      if (!options.nativeRinging) {
        void this.d.native.reportIncoming(callId, peer.display_name, media === 'video');
      }
    } else if (!options.nativeRinging) {
      if (this.d.native.available && this.d.isAppActive && !this.d.isAppActive()) {
        // Backgrounded (socket still alive): ring through the full-screen notification, the
        // same one the FCM push would post, instead of playing audio from a hidden app.
        this.d.native.showIncoming({
          call_id: callId,
          caller_id: peer.id,
          caller_name: peer.display_name,
          media,
          expires_at: '',
        });
        this.d.store.setState({ nativeRinging: true });
      } else {
        this.d.audio.startRingtone(45);
      }
    }
    this.armRingSafety(callId);
  }

  private declineIfBusy(callId: string): boolean {
    if (!isLive(this.machine.phase) || this.machine.callId === callId) return false;
    // One call at a time: a second incoming call is declined as busy.
    this.handledIncoming.add(callId);
    this.d.breadcrumb?.('incoming call auto-declined (busy)');
    if (this.d.ws.isOpen()) {
      this.d.ws.request('call.decline', { call_id: callId }).catch(() => undefined);
    }
    this.d.native.dismissIncoming(callId);
    this.d.native.reportEnded(callId, 'busy');
    return true;
  }

  private async verifyStillRinging(callId: string): Promise<void> {
    try {
      const call = await this.d.api.getCall(callId);
      if (call.state === 'ended' && this.machine.callId === callId) {
        this.onServerEnded(callId, call.end_reason ?? 'missed');
      }
    } catch {
      // offline: the ring safety timer still ends it
    }
  }

  async accept(options: { fromNative?: boolean } = {}): Promise<void> {
    const m = this.machine;
    const callId = m.callId;
    if (!callId || m.phase !== 'incoming') return;
    this.dispatch({ type: 'ACCEPT', callId });
    if (!this.isCurrent(callId, ['connecting'])) return;
    this.clearRingSafety();
    this.d.audio.stopRingtone();
    this.d.native.dismissIncoming(callId);
    this.nativeAnswered = options.fromNative === true;
    if (!options.fromNative) this.d.native.answer(callId);
    // CallKit activated the audio session before JS may have been listening (cold start).
    else if (this.d.native.systemRingsIncoming) this.d.onAudioSession?.(true);

    if (!(await this.prepareLocalMedia(m.media, callId))) {
      if (this.d.ws.isOpen()) {
        this.d.ws.request('call.decline', { call_id: callId }).catch(() => undefined);
      }
      return;
    }
    if (!(await this.waitForSocket())) {
      this.fail(callId, 'offline');
      return;
    }
    if (!this.isCurrent(callId, ['connecting'])) return;
    try {
      const ack = await this.d.ws.request('call.accept', { call_id: callId });
      if (!this.isCurrent(callId, ['connecting'])) return;
      this.ice.set(ack.ice_servers);
      this.dispatch({ type: 'ACCEPT_ACKED', callId });
      this.createSession('callee');
    } catch (error) {
      const code = errorCode(error);
      this.log('accept failed', { code });
      this.dispatch({
        type: 'ACCEPT_FAILED',
        callId,
        // The caller hung up / it timed out between ring and answer.
        reason:
          code === 'call_not_found' ? 'cancelled' : code === 'not_connected' ? 'offline' : 'error',
        at: this.timers.now(),
      });
    }
  }

  decline(): void {
    if (this.machine.phase !== 'incoming') return;
    this.hangup();
  }

  // ───────────────────────── hang up / end ─────────────────────────

  hangup(options: { fromNative?: boolean } = {}): void {
    const m = this.machine;
    const callId = m.callId;
    if (!callId || !isLive(m.phase)) return;
    const outcome = localHangupOutcome(m);
    if (outcome && this.d.ws.isOpen()) {
      const request =
        outcome.action === 'decline'
          ? this.d.ws.request('call.decline', { call_id: callId })
          : this.d.ws.request('call.hangup', { call_id: callId, reason: outcome.reason });
      request.catch((error: unknown) =>
        this.log('hangup request failed', { code: errorCode(error) }),
      );
    }
    if (!options.fromNative) this.d.native.end(callId);
    this.dispatch({ type: 'HANGUP', at: this.timers.now() });
  }

  private onServerEnded(callId: string, reason: CallEndReason): void {
    this.d.native.dismissIncoming(callId);
    if (this.machine.callId !== callId) {
      this.d.native.reportEnded(callId, reason);
      return;
    }
    this.dispatch({ type: 'SERVER_ENDED', callId, reason, at: this.timers.now() });
  }

  /** `call.ended` push (stops ringing when the socket missed the event). */
  handlePushEnded(callId: string, reason: string): void {
    const known: CallEndReason[] = [
      'completed',
      'missed',
      'declined',
      'cancelled',
      'failed',
      'busy',
      'answered_elsewhere',
      'timeout',
    ];
    this.onServerEnded(
      callId,
      known.includes(reason as CallEndReason) ? (reason as CallEndReason) : 'missed',
    );
  }

  private fail(callId: string, reason: CallEndKind): void {
    if (this.machine.callId !== callId) return;
    const outcome = localHangupOutcome(this.machine);
    if (outcome && this.d.ws.isOpen() && this.machine.accepted) {
      this.d.ws
        .request('call.hangup', { call_id: callId, reason: 'failed' })
        .catch(() => undefined);
    }
    this.dispatch({ type: 'LOCAL_FAILURE', reason, at: this.timers.now() });
  }

  /** Close the end screen. */
  dismissEnded(): void {
    if (this.machine.phase === 'ended') this.dispatch({ type: 'RESET' });
  }

  /** Sign-out: end anything live and forget everything. */
  reset(): void {
    if (isLive(this.machine.phase)) this.hangup();
    this.teardown();
    this.d.store.setState({ ...initialCallStoreState, screenOpen: this.state.screenOpen });
    this.handledIncoming.clear();
  }

  private onPhaseChange(prev: string, next: string): void {
    const m = this.machine;
    if (next === 'ringing') this.d.audio.startRingback();
    if (next === 'connecting' || next === 'reconnecting') this.armMediaTimeout(next);
    else this.clearMediaTimeout();
    if (next === 'connected' && prev === 'connecting') {
      this.d.haptic?.('connected');
      if (m.callId) {
        this.d.native.reportConnected(m.callId);
        this.d.native.startOngoing(m.callId, m.peer?.display_name ?? '', m.media === 'video');
      }
      this.startStats();
    }
    if (next === 'reconnecting') this.metrics.recordReconnect();
    if (next === 'ended') {
      this.d.haptic?.('ended');
      if (m.callId && m.endReason) {
        this.d.native.reportEnded(m.callId, m.endReason);
        this.d.native.dismissIncoming(m.callId);
      }
      this.teardown();
    }
  }

  private teardown(): void {
    const m = this.machine;
    this.clearRingSafety();
    this.clearMediaTimeout();
    this.stopStats();
    this.d.audio.stopRingtone();
    this.d.audio.stopRingback();
    this.d.audio.stop();
    this.d.native.stopOngoing();
    this.d.native.setShowWhenLocked(false);
    if (this.session) {
      if (m.callId && m.connectedAt !== null) this.uploadMetrics(m.callId);
      this.session.close();
      this.session = null;
    }
    this.d.media.stop(this.localStream);
    this.localStream = null;
    this.pendingSignals = [];
    this.quality = null;
    this.statsCursor = null;
    this.cameraPausedForBackground = false;
    this.nativeAnswered = false;
    this.d.store.setState({ localStreamUrl: null, remoteStreamUrl: null, iceState: null });
  }

  // ───────────────────────── media ─────────────────────────

  private resetUi(media: CallMedia): void {
    this.metrics = new MetricsAggregator();
    this.d.store.setState({
      ...initialCallStoreState,
      machine: this.machine,
      screenOpen: this.state.screenOpen,
      videoPref: this.state.videoPref,
      audioPref: this.state.audioPref,
      cameraOn: media === 'video',
      speakerOn: media === 'video',
    });
  }

  /** Permissions + getUserMedia. Ends the call (with the right reason) on failure. */
  private async prepareLocalMedia(media: CallMedia, callId: string): Promise<boolean> {
    let granted = false;
    try {
      granted = await this.d.media.ensurePermissions(media);
    } catch {
      granted = false;
    }
    if (!granted) {
      this.fail(callId, 'permission_denied');
      return false;
    }
    try {
      const stream = await this.d.media.acquire(media, {
        facing: this.state.facing,
        maxTier: this.d.deviceVideoCap(),
      });
      if (this.machine.callId !== callId || !isLive(this.machine.phase)) {
        this.d.media.stop(stream);
        return false;
      }
      this.localStream = stream;
      this.d.store.setState({ localStreamUrl: stream.toURL?.() ?? null });
      this.d.audio.start(media);
      this.d.audio.setSpeaker(this.state.speakerOn);
      return true;
    } catch (error) {
      this.fail(
        callId,
        errorCode(error) === 'permission_denied' ? 'permission_denied' : 'media_error',
      );
      return false;
    }
  }

  private createSession(role: 'caller' | 'callee'): void {
    const m = this.machine;
    const callId = m.callId;
    if (!callId || this.session) return;
    const videoTrack = this.localStream?.getVideoTracks()[0] ?? null;
    this.quality = new QualityController({
      deviceCap: this.d.deviceVideoCap(),
      captureHeight: this.d.media.captureHeight(videoTrack) ?? 720,
    });
    this.quality.setVideoActive(m.media === 'video' && this.state.cameraOn);
    const session = new PeerSession({
      role,
      createPeerConnection: this.d.createPeerConnection,
      iceServers: this.ice.get(),
      timers: this.timers,
      sendSignal: (signal) => this.sendSignal(callId, signal),
      getOpusParams: () => {
        const audio = this.quality?.decision().audio;
        return { fec: true, dtx: audio?.dtx ?? false, stereo: false };
      },
      refreshIceServers: async () => (await this.ice.ensureFresh()).servers,
      onRemoteStream: (stream) =>
        this.d.store.setState({ remoteStreamUrl: stream.toURL?.() ?? null }),
      onIceConnectionState: (state) => this.onIceState(state),
      onRestart: (reason) => this.d.breadcrumb?.('ice restart', { reason }),
      log: (message, data) => this.log(`peer: ${message}`, data),
    });
    this.session = session;
    if (this.localStream) session.addLocalStream(this.localStream);
    void this.applyDecision(this.quality.decision());
    // Signals that raced ahead of our accept ack (the caller's offer + candidates), in order.
    const buffered = this.pendingSignals.splice(0);
    void (async () => {
      for (const signal of buffered) await session.handleSignal(signal);
    })();
    // Tell the peer what I want to receive if it isn't the default.
    if (this.state.videoPref !== 'auto' || this.state.audioPref !== 'auto') this.sendQualityPref();
  }

  private async sendSignal(callId: string, signal: CallSignal): Promise<void> {
    try {
      await this.d.ws.request('call.signal', { call_id: callId, signal });
    } catch (error) {
      if (errorCode(error) === 'call_not_found' && this.machine.callId === callId) {
        // The server already ended the call (e.g. grace expired while we were offline).
        this.onServerEnded(callId, 'failed');
        return;
      }
      throw error;
    }
  }

  private async onSignal(callId: string, signal: CallSignal): Promise<void> {
    if (callId !== this.machine.callId || !isLive(this.machine.phase)) return;
    if (signal.type === 'quality') {
      if (!this.quality) return;
      const decision = this.quality.setRemotePreference(signal.video, signal.audio);
      await this.applyDecision(decision);
      return;
    }
    if (!this.session) {
      this.pendingSignals.push(signal);
      return;
    }
    await this.session.handleSignal(signal);
  }

  private onIceState(state: string): void {
    this.d.store.setState({ iceState: state });
    if (state === 'connected' || state === 'completed') {
      this.dispatch({ type: 'MEDIA_CONNECTED', at: this.timers.now() });
    } else if (state === 'disconnected' || state === 'failed') {
      this.dispatch({ type: 'MEDIA_INTERRUPTED' });
    }
  }

  // ───────────────────────── controls ─────────────────────────

  setMuted(muted: boolean, options: { fromNative?: boolean } = {}): void {
    for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = !muted;
    this.d.store.setState({ micMuted: muted });
    const callId = this.machine.callId;
    if (callId && !options.fromNative) this.d.native.setMuted(callId, muted);
    this.sendMediaState();
  }

  toggleMute(): void {
    this.setMuted(!this.state.micMuted);
  }

  toggleSpeaker(): void {
    const on = !this.state.speakerOn;
    this.d.audio.setSpeaker(on);
    this.d.store.setState({ speakerOn: on });
  }

  setCameraOn(on: boolean): void {
    for (const track of this.localStream?.getVideoTracks() ?? []) track.enabled = on;
    this.d.store.setState({ cameraOn: on });
    this.quality?.setVideoActive(on);
    this.sendMediaState();
  }

  toggleCamera(): void {
    this.setCameraOn(!this.state.cameraOn);
  }

  async flipCamera(): Promise<void> {
    const track = this.localStream?.getVideoTracks()[0];
    if (!track) return;
    try {
      const facing = await this.d.media.switchCamera(track, this.state.facing);
      this.d.store.setState({ facing });
      const height = this.d.media.captureHeight(track);
      if (height && this.quality) await this.applyDecision(this.quality.setCaptureHeight(height));
    } catch (error) {
      this.log('camera switch failed', { error: String(error) });
    }
  }

  private sendMediaState(): void {
    const m = this.machine;
    if (!m.callId || !m.accepted || !this.d.ws.isOpen()) return;
    this.d.ws.send('call.media_state', {
      call_id: m.callId,
      audio_muted: this.state.micMuted,
      video_enabled: m.media === 'video' && this.state.cameraOn,
    });
  }

  /** What I want to receive (sent to the peer, applied live by its sender). */
  setVideoPreference(pref: VideoQualityPref): void {
    if (pref === this.state.videoPref) return;
    this.d.store.setState({ videoPref: pref });
    this.sendQualityPref();
  }

  setAudioPreference(pref: AudioQualityPref): void {
    if (pref === this.state.audioPref) return;
    this.d.store.setState({ audioPref: pref });
    this.sendQualityPref();
  }

  private sendQualityPref(): void {
    const m = this.machine;
    if (!m.callId || !m.accepted || !this.session) return;
    void this.sendSignal(m.callId, {
      type: 'quality',
      video: this.state.videoPref,
      audio: this.state.audioPref,
    }).catch((error: unknown) => this.log('quality signal failed', { code: errorCode(error) }));
  }

  // ───────────────────────── quality + stats ─────────────────────────

  private async applyDecision(decision: QualityDecision): Promise<void> {
    const prev = this.state.sendDecision;
    this.d.store.setState({ sendDecision: decision });
    const session = this.session;
    if (!session) return;
    const videoChanged =
      !prev ||
      prev.video.tier !== decision.video.tier ||
      prev.video.scaleResolutionDownBy !== decision.video.scaleResolutionDownBy;
    if (videoChanged && this.machine.media === 'video') {
      if (prev && prev.video.tier !== decision.video.tier) this.metrics.recordVideoQualityChange();
      await session.applyVideoEncoding(decision.video);
    }
    if (!prev || prev.audio.preset !== decision.audio.preset) {
      await session.applyAudioEncoding(decision.audio);
      const now = this.timers.now();
      // DTX lives in the SDP: renegotiate (rate-limited) once the call is up.
      if (
        session.needsDtxRenegotiation() &&
        this.machine.phase === 'connected' &&
        now - this.lastDtxRenegotiationAt > 15_000
      ) {
        this.lastDtxRenegotiationAt = now;
        await session.renegotiate();
      }
    }
  }

  private startStats(): void {
    if (this.statsTimer !== null) return;
    const interval = this.d.statsIntervalMs ?? 2_000;
    const tick = async () => {
      this.statsTimer = null;
      await this.sampleStats();
      if (this.session && isLive(this.machine.phase)) {
        this.statsTimer = this.timers.setTimeout(() => void tick(), interval);
      }
    };
    this.statsTimer = this.timers.setTimeout(() => void tick(), interval);
  }

  private stopStats(): void {
    if (this.statsTimer !== null) this.timers.clearTimeout(this.statsTimer);
    this.statsTimer = null;
  }

  async sampleStats(): Promise<void> {
    const session = this.session;
    if (!session) return;
    let report: unknown;
    try {
      report = await session.getStats();
    } catch {
      return;
    }
    if (!report || this.session !== session) return;
    const { stats, cursor } = normalizeStats(
      report as Parameters<typeof normalizeStats>[0],
      this.statsCursor,
      this.timers.now(),
    );
    const firstSample = this.statsCursor === null;
    this.statsCursor = cursor;
    if (!firstSample) this.metrics.addSample(stats);
    this.d.store.setState({ stats, networkLevel: networkQualityLevel(stats) });
    if (this.quality && this.machine.phase === 'connected') {
      await this.applyDecision(this.quality.addSample(toQualitySample(stats)));
    }
  }

  private uploadMetrics(callId: string): void {
    const m = this.machine;
    const body = this.metrics.summary({
      durationSec: callDurationSec(m, this.timers.now()),
      networkType: this.d.networkType(),
      selectedVideo: this.state.videoPref,
      selectedAudio: this.state.audioPref,
    });
    const api = this.d.api;
    const timers = this.timers;
    const log = (message: string, data?: Record<string, unknown>) => this.log(message, data);
    void (async () => {
      const delays = [0, 2_000, 6_000, 15_000];
      for (const delay of delays) {
        if (delay) await sleep(timers, delay);
        try {
          await api.postMetrics(callId, body);
          return;
        } catch (error) {
          const status = (error as { status?: number } | null)?.status ?? 0;
          // 4xx other than 429 will never succeed.
          if (status >= 400 && status < 500 && status !== 429) break;
        }
      }
      log('metrics upload gave up');
    })();
  }

  // ───────────────────────── resilience ─────────────────────────

  private async onWsReconnected(): Promise<void> {
    const m = this.machine;
    const callId = m.callId;
    if (!callId || !isLive(m.phase)) return;
    // Events emitted while we were offline are lost: ask the server where the call stands.
    try {
      const call = await this.d.api.getCall(callId);
      if (call.state === 'ended') {
        this.onServerEnded(callId, call.end_reason ?? 'failed');
        return;
      }
      if (m.direction === 'outgoing' && call.state === 'active' && !this.machine.accepted) {
        this.onAccepted(callId, '');
        return;
      }
    } catch {
      // keep going; signaling errors will tell us if the call is gone
    }
    if (this.session && this.machine.callId === callId) {
      await this.session.restartIce('ws_reconnect');
    }
  }

  /** NetInfo change during a call: the old ICE path is likely dead (Wi-Fi ⇄ cellular). */
  onNetworkChange(info: {
    type: string;
    isConnected: boolean | null;
    details?: string | null;
  }): void {
    const key = `${info.type}:${info.details ?? ''}`;
    const previous = this.lastNetworkKey;
    this.lastNetworkKey = key;
    if (previous === null || previous === key || info.isConnected === false) return;
    if (this.session && ['connected', 'reconnecting', 'connecting'].includes(this.machine.phase)) {
      void this.session.restartIce('network_change');
    }
  }

  onAppStateChange(active: boolean): void {
    const m = this.machine;
    if (m.media !== 'video' || !isLive(m.phase)) return;
    if (!active && this.state.cameraOn) {
      // The OS stops background camera capture anyway; tell the peer instead of freezing.
      this.cameraPausedForBackground = true;
      this.setCameraOn(false);
    } else if (active && this.cameraPausedForBackground) {
      this.cameraPausedForBackground = false;
      this.setCameraOn(true);
    }
  }

  private armRingSafety(callId: string): void {
    this.clearRingSafety();
    this.ringTimer = this.timers.setTimeout(() => {
      this.ringTimer = null;
      const m = this.machine;
      if (m.callId !== callId) return;
      if (m.phase === 'incoming') {
        this.dispatch({ type: 'SERVER_ENDED', callId, reason: 'missed', at: this.timers.now() });
      } else if (m.phase === 'outgoing' || m.phase === 'ringing') {
        this.hangup();
      }
    }, this.d.ringSafetyMs ?? 55_000);
  }

  /** ICE that never (re)connects while signaling is fine: give up instead of hanging forever. */
  private armMediaTimeout(phase: string): void {
    this.clearMediaTimeout();
    const callId = this.machine.callId;
    if (!callId) return;
    this.mediaTimer = this.timers.setTimeout(() => {
      this.mediaTimer = null;
      if (this.isCurrent(callId, [phase])) this.fail(callId, 'failed');
    }, this.d.mediaTimeoutMs ?? 30_000);
  }

  private clearMediaTimeout(): void {
    if (this.mediaTimer !== null) this.timers.clearTimeout(this.mediaTimer);
    this.mediaTimer = null;
  }

  private clearRingSafety(): void {
    if (this.ringTimer !== null) this.timers.clearTimeout(this.ringTimer);
    this.ringTimer = null;
  }

  private async waitForSocket(): Promise<boolean> {
    if (this.d.ws.isOpen()) return true;
    const timeoutMs = this.d.wsWaitMs ?? 8_000;
    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        off();
        this.timers.clearTimeout(timer);
        resolve(ok);
      };
      const off = this.d.ws.onStateChange((state) => {
        if (state === 'open') finish(true);
        if (state === 'stopped') finish(false);
      });
      const timer = this.timers.setTimeout(() => finish(this.d.ws.isOpen()), timeoutMs);
    });
  }

  private isCurrent(callId: string, phases: string[]): boolean {
    return this.machine.callId === callId && phases.includes(this.machine.phase);
  }

  // ───────────────────────── native actions ─────────────────────────

  handleNativeAction(event: NativeCallActionEvent): void {
    const payload: IncomingCallPayload | null =
      event.callerId && event.media
        ? {
            call_id: event.callId,
            caller_id: event.callerId,
            caller_name: event.callerName ?? '',
            media: event.media === 'video' ? 'video' : 'audio',
            expires_at: event.expiresAt ?? '',
          }
        : null;
    switch (event.action) {
      case 'show':
        if (payload) this.handleIncomingPush(payload, { nativeRinging: true });
        return;
      case 'answer':
        if (payload && this.machine.callId !== event.callId) {
          this.handleIncomingPush(payload, { nativeRinging: true });
        }
        if (this.machine.callId === event.callId) void this.accept({ fromNative: true });
        return;
      case 'decline':
      case 'end':
        if (this.machine.callId === event.callId && isLive(this.machine.phase)) {
          this.hangup({ fromNative: true });
        } else if (event.action === 'decline' && this.d.ws.isOpen()) {
          this.d.ws.request('call.decline', { call_id: event.callId }).catch(() => undefined);
        }
        return;
      case 'mute':
      case 'unmute':
        if (this.machine.callId === event.callId) {
          this.setMuted(event.action === 'mute', { fromNative: true });
        }
        return;
      default:
        return;
    }
  }

  /** Buffered native actions (e.g. Answer tapped while the app was killed). */
  processPendingNativeActions(): void {
    for (const event of this.d.native.consumePendingActions()) this.handleNativeAction(event);
  }

  get answeredFromNative(): boolean {
    return this.nativeAnswered;
  }

  /** Received-video label helper input: the tier the peer is actually sending us. */
  receivedTier(): VideoTier | null {
    const v = this.state.stats?.inboundVideo;
    if (!v?.width || !v.height) return null;
    return tierForHeight(Math.min(v.width, v.height));
  }
}

export function toPeer(
  user: Pick<PublicUser, 'id' | 'display_name' | 'avatar_color'> & {
    username?: string;
  },
): CallPeer {
  return {
    id: user.id,
    display_name: user.display_name,
    avatar_color: user.avatar_color,
    ...(user.username ? { username: user.username } : {}),
  };
}
