import type { CallSignal, IceServer } from '@/types/protocol';

import { toRtcIceServers } from './iceServers';
import type { AudioEncoding, VideoEncoding } from './quality/QualityController';
import { byteLength, MAX_SIGNAL_BYTES, mungeOpus, type OpusParams } from './sdp';
import type {
  IceCandidateEventLike,
  IceCandidateInit,
  MediaStreamLike,
  PeerConnectionFactory,
  PeerConnectionLike,
  RtpSenderLike,
  TrackEventLike,
} from './types';

/**
 * One RTCPeerConnection for one 1-to-1 call, with negotiation rules that make glare impossible:
 *
 *  - The **caller is always the offerer** (initial offer, ICE restarts, renegotiations). The callee
 *    never creates offers; when it needs one it sends `{type:"renegotiate"}`.
 *  - Remote ICE candidates that arrive before the remote description are queued and flushed
 *    right after `setRemoteDescription`.
 *  - A new offer requested while one is in flight is coalesced and sent after the answer.
 *  - ICE `failed` restarts immediately; `disconnected` restarts after a grace period (the
 *    connection often self-heals). Restarts are rate-limited.
 *
 * Signaling transport, timers and the PeerConnection itself are injected (testable).
 */

export type PeerRole = 'caller' | 'callee';

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export interface PeerSessionOptions {
  role: PeerRole;
  createPeerConnection: PeerConnectionFactory;
  iceServers: IceServer[];
  sendSignal: (signal: CallSignal) => Promise<void>;
  /** Opus FEC/DTX preferences written into the remote SDP before applying it. */
  getOpusParams: () => OpusParams;
  /** Called before an ICE restart; may return fresher ICE servers (TURN credentials). */
  refreshIceServers?: () => Promise<IceServer[] | null>;
  onRemoteStream?: (stream: MediaStreamLike) => void;
  onIceConnectionState?: (state: string) => void;
  onConnectionState?: (state: string) => void;
  onRestart?: (reason: string) => void;
  log?: (message: string, data?: Record<string, unknown>) => void;
  timers?: Timers;
  disconnectGraceMs?: number;
  minRestartIntervalMs?: number;
}

export class PeerSession {
  readonly role: PeerRole;
  private readonly pc: PeerConnectionLike;
  private readonly opts: PeerSessionOptions;
  private readonly timers: Timers;
  private readonly disconnectGraceMs: number;
  private readonly minRestartIntervalMs: number;

  private readonly queuedCandidates: IceCandidateInit[] = [];
  private readonly senders = new Map<'audio' | 'video', RtpSenderLike>();
  private makingOffer = false;
  private pendingOffer: { iceRestart: boolean } | null = null;
  private closed = false;
  private disconnectTimer: unknown = null;
  private restartTimer: unknown = null;
  private lastRestartAt = -Infinity;
  private restartPending = false;
  private remoteStream: MediaStreamLike | null = null;
  private appliedDtx: boolean | null = null;

  constructor(options: PeerSessionOptions) {
    this.opts = options;
    this.role = options.role;
    this.timers = options.timers ?? defaultTimers;
    this.disconnectGraceMs = options.disconnectGraceMs ?? 2_500;
    this.minRestartIntervalMs = options.minRestartIntervalMs ?? 3_000;
    this.pc = options.createPeerConnection({
      iceServers: toRtcIceServers(options.iceServers),
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 2,
    });
    this.pc.addEventListener('icecandidate', ((e: IceCandidateEventLike) =>
      this.onLocalCandidate(e)) as (event: never) => void);
    this.pc.addEventListener('track', ((e: TrackEventLike) => this.onTrack(e)) as (
      event: never,
    ) => void);
    this.pc.addEventListener('iceconnectionstatechange', (() => this.onIceStateChange()) as (
      event: never,
    ) => void);
    this.pc.addEventListener('connectionstatechange', (() =>
      this.opts.onConnectionState?.(this.pc.connectionState)) as (event: never) => void);
  }

  get peerConnection(): PeerConnectionLike {
    return this.pc;
  }

  get iceConnectionState(): string {
    return this.pc.iceConnectionState;
  }

  get queuedCandidateCount(): number {
    return this.queuedCandidates.length;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  // ───────────────────────── media ─────────────────────────

  addLocalStream(stream: MediaStreamLike): void {
    for (const track of stream.getTracks()) {
      const sender = this.pc.addTrack(track, stream);
      if (track.kind === 'audio' || track.kind === 'video') this.senders.set(track.kind, sender);
    }
  }

  sender(kind: 'audio' | 'video'): RtpSenderLike | null {
    return this.senders.get(kind) ?? null;
  }

  // ───────────────────────── negotiation ─────────────────────────

  /** Caller only: create and send an offer (coalesced while another negotiation is in flight). */
  async startOffer(options: { iceRestart?: boolean } = {}): Promise<void> {
    if (this.closed) return;
    if (this.role !== 'caller') {
      this.log('offer requested on callee; asking caller to renegotiate');
      await this.safeSend({ type: 'renegotiate' });
      return;
    }
    const iceRestart = options.iceRestart === true;
    if (iceRestart && !this.makingOffer && this.pc.signalingState === 'have-local-offer') {
      // The previous offer (or its answer) was lost with the socket: roll back and re-offer.
      try {
        await this.pc.setLocalDescription({ type: 'rollback', sdp: '' });
      } catch (error) {
        this.log('rollback failed', { error: String(error) });
      }
    }
    if (this.makingOffer || this.pc.signalingState !== 'stable') {
      this.pendingOffer = { iceRestart: iceRestart || this.pendingOffer?.iceRestart === true };
      return;
    }
    this.makingOffer = true;
    try {
      const offer = await this.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      if (this.closed) return;
      await this.pc.setLocalDescription(offer);
      const signal: CallSignal = iceRestart
        ? { type: 'offer', sdp: offer.sdp, iceRestart: true }
        : { type: 'offer', sdp: offer.sdp };
      await this.safeSend(signal);
      this.log('offer sent', { iceRestart });
    } finally {
      this.makingOffer = false;
    }
  }

  async handleSignal(signal: CallSignal): Promise<void> {
    if (this.closed) return;
    switch (signal.type) {
      case 'offer':
        await this.onRemoteOffer(signal.sdp);
        return;
      case 'answer':
        await this.onRemoteAnswer(signal.sdp);
        return;
      case 'candidate':
        await this.onRemoteCandidate(signal.candidate);
        return;
      case 'renegotiate':
        if (this.role === 'caller') {
          const broken = ['failed', 'disconnected'].includes(this.pc.iceConnectionState);
          await this.startOffer({ iceRestart: broken });
        }
        return;
      default:
        return; // `quality` is handled by the call controller
    }
  }

  private async onRemoteOffer(sdp: string): Promise<void> {
    if (this.role === 'caller') {
      // The callee never offers in this protocol; ignoring keeps us glare-free.
      this.log('unexpected offer on caller ignored');
      return;
    }
    await this.applyRemote({ type: 'offer', sdp });
    const answer = await this.pc.createAnswer();
    if (this.closed) return;
    await this.pc.setLocalDescription(answer);
    await this.safeSend({ type: 'answer', sdp: answer.sdp });
    this.log('answer sent');
  }

  private async onRemoteAnswer(sdp: string): Promise<void> {
    if (this.role !== 'caller' || this.pc.signalingState !== 'have-local-offer') {
      this.log('stale answer ignored', { signalingState: this.pc.signalingState });
      return;
    }
    await this.applyRemote({ type: 'answer', sdp });
    const pending = this.pendingOffer;
    this.pendingOffer = null;
    if (pending) await this.startOffer(pending);
  }

  private async applyRemote(desc: { type: 'offer' | 'answer'; sdp: string }): Promise<void> {
    const opus = this.opts.getOpusParams();
    await this.pc.setRemoteDescription({ type: desc.type, sdp: mungeOpus(desc.sdp, opus) });
    this.appliedDtx = opus.dtx;
    await this.flushCandidates();
  }

  private async onRemoteCandidate(candidate: IceCandidateInit): Promise<void> {
    if (!this.pc.remoteDescription) {
      this.queuedCandidates.push(candidate);
      return;
    }
    await this.addCandidate(candidate);
  }

  private async flushCandidates(): Promise<void> {
    const queued = this.queuedCandidates.splice(0);
    for (const c of queued) await this.addCandidate(c);
  }

  private async addCandidate(candidate: IceCandidateInit): Promise<void> {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (error) {
      // Candidates from an old ICE generation fail harmlessly after a restart.
      this.log('addIceCandidate failed', { error: String(error) });
    }
  }

  /** Whether DTX in the applied remote SDP differs from what the current audio preset wants. */
  needsDtxRenegotiation(): boolean {
    return this.appliedDtx !== null && this.appliedDtx !== this.opts.getOpusParams().dtx;
  }

  /** Re-apply SDP-only settings (Opus DTX): caller re-offers, callee asks the caller to. */
  async renegotiate(): Promise<void> {
    if (this.closed) return;
    if (this.role === 'caller') await this.startOffer({ iceRestart: false });
    else await this.safeSend({ type: 'renegotiate' });
  }

  // ───────────────────────── ICE ─────────────────────────

  private onLocalCandidate(event: IceCandidateEventLike): void {
    const c = event.candidate;
    if (!c || !c.candidate || this.closed) return;
    const json = typeof c.toJSON === 'function' ? c.toJSON() : c;
    const candidate: IceCandidateInit = {
      candidate: json.candidate,
      sdpMid: json.sdpMid ?? null,
      sdpMLineIndex: json.sdpMLineIndex ?? null,
    };
    if (typeof json.usernameFragment === 'string' && json.usernameFragment) {
      candidate.usernameFragment = json.usernameFragment;
    }
    void this.safeSend({
      type: 'candidate',
      candidate: {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        ...(candidate.usernameFragment ? { usernameFragment: candidate.usernameFragment } : {}),
      },
    });
  }

  private onTrack(event: TrackEventLike): void {
    const stream = event.streams[0];
    if (stream && stream !== this.remoteStream) {
      this.remoteStream = stream;
      this.opts.onRemoteStream?.(stream);
    }
  }

  private onIceStateChange(): void {
    const state = this.pc.iceConnectionState;
    this.opts.onIceConnectionState?.(state);
    if (this.closed) return;
    if (state === 'connected' || state === 'completed') {
      this.clearDisconnectTimer();
      return;
    }
    if (state === 'failed') {
      this.clearDisconnectTimer();
      void this.restartIce('ice_failed');
      return;
    }
    if (state === 'disconnected' && this.disconnectTimer === null) {
      this.disconnectTimer = this.timers.setTimeout(() => {
        this.disconnectTimer = null;
        if (this.pc.iceConnectionState === 'disconnected') void this.restartIce('ice_disconnected');
      }, this.disconnectGraceMs);
    }
  }

  /**
   * ICE restart (debounced and rate-limited). Triggered by ICE failure, a WebSocket reconnect
   * within the server's grace window, or a network change.
   */
  async restartIce(reason: string): Promise<void> {
    if (this.closed) return;
    const now = this.timers.now();
    const wait = this.lastRestartAt + this.minRestartIntervalMs - now;
    if (wait > 0) {
      if (!this.restartPending) {
        this.restartPending = true;
        this.restartTimer = this.timers.setTimeout(() => {
          this.restartPending = false;
          this.restartTimer = null;
          void this.restartIce(reason);
        }, wait);
      }
      return;
    }
    this.lastRestartAt = now;
    this.opts.onRestart?.(reason);
    this.log('ice restart', { reason });
    if (this.role === 'callee') {
      await this.safeSend({ type: 'renegotiate' });
      return;
    }
    if (this.opts.refreshIceServers) {
      try {
        const fresh = await this.opts.refreshIceServers();
        if (fresh && fresh.length > 0) {
          this.pc.setConfiguration?.({ iceServers: toRtcIceServers(fresh) });
        }
      } catch {
        // keep the current servers
      }
    }
    await this.startOffer({ iceRestart: true });
  }

  /** Apply fresher ICE servers without a restart (used before a callee-side restart request). */
  updateIceServers(servers: IceServer[]): void {
    if (servers.length > 0) this.pc.setConfiguration?.({ iceServers: toRtcIceServers(servers) });
  }

  // ───────────────────────── encodings ─────────────────────────

  async applyVideoEncoding(encoding: VideoEncoding): Promise<boolean> {
    const sender = this.senders.get('video');
    if (!sender || this.closed) return false;
    const params = sender.getParameters();
    const first = params.encodings[0];
    if (!first) return false;
    first.maxBitrate = encoding.maxBitrate;
    first.maxFramerate = encoding.maxFramerate;
    first.scaleResolutionDownBy = encoding.scaleResolutionDownBy;
    params.degradationPreference = 'balanced';
    try {
      await sender.setParameters(params);
      return true;
    } catch (error) {
      this.log('video setParameters failed', { error: String(error) });
      return false;
    }
  }

  async applyAudioEncoding(encoding: AudioEncoding): Promise<boolean> {
    const sender = this.senders.get('audio');
    if (!sender || this.closed) return false;
    const params = sender.getParameters();
    const first = params.encodings[0];
    if (!first) return false;
    first.maxBitrate = encoding.maxBitrate;
    // Honoured where the native layer supports it; ignored otherwise.
    first.priority = 'high';
    first.networkPriority = 'high';
    try {
      await sender.setParameters(params);
      return true;
    } catch (error) {
      this.log('audio setParameters failed', { error: String(error) });
      return false;
    }
  }

  // ───────────────────────── misc ─────────────────────────

  getStats(): Promise<unknown> {
    return this.pc.getStats();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearDisconnectTimer();
    if (this.restartTimer !== null) this.timers.clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.queuedCandidates.length = 0;
    try {
      this.pc.close();
    } catch {
      // already closed
    }
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer !== null) this.timers.clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }

  private async safeSend(signal: CallSignal): Promise<void> {
    if (this.closed) return;
    if ('sdp' in signal && byteLength(JSON.stringify(signal)) > MAX_SIGNAL_BYTES) {
      this.log('signal exceeds 16 KiB; not sent', { type: signal.type });
      return;
    }
    try {
      await this.opts.sendSignal(signal);
    } catch (error) {
      // The socket may be reconnecting; the post-reconnect ICE restart re-sends what matters.
      this.log('signal send failed', { type: signal.type, error: String(error) });
    }
  }

  private log(message: string, data?: Record<string, unknown>): void {
    this.opts.log?.(message, data);
  }
}
