import { AdaptiveController } from './adaptive';
import { captureShortSide, maxCaptureShortSide, videoConstraints } from './media';
import {
  audioLevel,
  initialAudioLevel,
  initialVideoLevel,
  maxLevelForCapture,
  videoIndex,
  videoLevel,
  type AudioLevelId,
  type AudioPref,
  type VideoLevelId,
  type VideoPref,
} from './quality';
import { tuneOpus } from './sdp';
import { StatsSampler, type CallStats } from './stats';

export type SignalPayload =
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'candidate'; candidate: RTCIceCandidateInit }
  | { type: 'restart' };

export interface SendingInfo {
  video: VideoLevelId | null;
  audio: AudioLevelId;
  auto: boolean;
  videoPaused: boolean;
}

/** Messages exchanged over the in-call data channel. */
type Control =
  | { t: 'pref'; video: VideoPref; audio: AudioPref }
  | ({ t: 'sending' } & SendingInfo)
  | { t: 'caps'; maxVideo: VideoLevelId | null }
  | { t: 'media'; mic: boolean; cam: boolean };

export type LinkState = 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface SessionEvents {
  remoteStream(stream: MediaStream): void;
  localStream(stream: MediaStream): void;
  link(state: LinkState): void;
  stats(stats: CallStats): void;
  localSending(info: SendingInfo): void;
  peerSending(info: SendingInfo): void;
  peerCaps(maxVideo: VideoLevelId | null): void;
  peerMedia(state: { mic: boolean; cam: boolean }): void;
}

interface Options {
  role: 'caller' | 'callee';
  iceServers: RTCIceServer[];
  localStream: MediaStream;
  signal: (payload: SignalPayload) => void;
  events: SessionEvents;
}

const STATS_INTERVAL_MS = 1000;
const RECONNECT_GIVE_UP_MS = 30_000;

/**
 * One peer-to-peer call. Owns the RTCPeerConnection, applies quality levels to
 * the RTP senders and runs the adaptive controller from live stats.
 *
 * Quality model (YouTube-style): each user picks the quality they want to
 * *receive*. That preference travels over the data channel to the other side,
 * whose sender then either pins that level or — on "Auto" — lets the
 * adaptive controller pick the best level its uplink can sustain.
 */
export class CallSession {
  readonly pc: RTCPeerConnection;
  private dc: RTCDataChannel;
  private sampler: StatsSampler;
  private adaptive: AdaptiveController;
  private audioSender: RTCRtpSender | null = null;
  private videoSender: RTCRtpSender | null = null;
  private remoteStream = new MediaStream();
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remotePref: { video: VideoPref; audio: AudioPref } = { video: 'auto', audio: 'auto' };
  private localPref: { video: VideoPref; audio: AudioPref } = { video: 'auto', audio: 'auto' };
  private lastApplied: string | null = null;
  private applyChain: Promise<void> = Promise.resolve();
  private statsTimer: number | null = null;
  private tick = 0;
  private reconnectTimer: number | null = null;
  private giveUpTimer: number | null = null;
  private lastRestartAt = 0;
  private micOn = true;
  private camOn = true;
  private facing: 'user' | 'environment' = 'user';
  private maxShort = 1080;
  private closed = false;

  constructor(private opts: Options) {
    this.pc = new RTCPeerConnection({
      iceServers: opts.iceServers,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 2,
    });
    // Negotiated channel: both sides create it with the same id, no extra round trip.
    this.dc = this.pc.createDataChannel('ctl', { negotiated: true, id: 0, ordered: true });
    this.sampler = new StatsSampler(this.pc);

    const audioTrack = opts.localStream.getAudioTracks()[0];
    const videoTrack = opts.localStream.getVideoTracks()[0];
    if (audioTrack) this.audioSender = this.pc.addTrack(audioTrack, opts.localStream);
    if (videoTrack) {
      this.videoSender = this.pc.addTrack(videoTrack, opts.localStream);
      this.maxShort = maxCaptureShortSide(videoTrack);
    }
    const maxVideo = maxLevelForCapture(this.maxShort);
    this.adaptive = new AdaptiveController(initialVideoLevel(maxVideo), initialAudioLevel(), maxVideo);

    this.wire();
  }

  // ─── Public API ────────────────────────────────────────────────────────

  /** Caller only: send the initial offer once the callee has accepted. */
  async negotiate(iceRestart = false): Promise<void> {
    if (this.closed) return;
    const offer = await this.pc.createOffer({ iceRestart });
    await this.pc.setLocalDescription(offer);
    this.opts.signal({ type: 'offer', sdp: tuneOpus(offer.sdp ?? '') });
    this.scheduleApply();
  }

  async handleSignal(p: SignalPayload): Promise<void> {
    if (this.closed) return;
    switch (p.type) {
      case 'offer': {
        await this.pc.setRemoteDescription({ type: 'offer', sdp: p.sdp });
        await this.flushCandidates();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.opts.signal({ type: 'answer', sdp: tuneOpus(answer.sdp ?? '') });
        this.scheduleApply();
        break;
      }
      case 'answer':
        if (this.pc.signalingState !== 'have-local-offer') return;
        await this.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp });
        await this.flushCandidates();
        break;
      case 'candidate':
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(p.candidate).catch(() => {});
        else this.pendingCandidates.push(p.candidate);
        break;
      case 'restart':
        if (this.opts.role === 'caller') void this.restartIce(true);
        break;
    }
  }

  /** What *I* want to receive. Sent to the peer, whose sender obeys it. */
  setReceivePrefs(video: VideoPref, audio: AudioPref): void {
    this.localPref = { video, audio };
    this.send({ t: 'pref', video, audio });
  }

  setMicEnabled(on: boolean): void {
    this.micOn = on;
    this.opts.localStream.getAudioTracks().forEach((t) => (t.enabled = on));
    this.sendMedia();
  }

  setCamEnabled(on: boolean): void {
    this.camOn = on;
    this.opts.localStream.getVideoTracks().forEach((t) => (t.enabled = on));
    this.sendMedia();
    this.lastApplied = null;
    this.scheduleApply(); // deactivate the encoding entirely while the camera is off
  }

  async switchCamera(): Promise<void> {
    const old = this.opts.localStream.getVideoTracks()[0];
    if (!old || !this.videoSender) return;
    const next = this.facing === 'user' ? 'environment' : 'user';
    const short = captureShortSide(old);
    // Many Android devices can't open two cameras at once: release the current one first.
    old.stop();
    let track: MediaStreamTrack;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(next, short, true) });
      track = fresh.getVideoTracks()[0];
    } catch (err) {
      // Switching failed: bring the previous camera back so video keeps flowing.
      const restore = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(this.facing, short) });
      track = restore.getVideoTracks()[0];
      this.swapTrack(old, track);
      await this.videoSender.replaceTrack(track);
      throw err;
    }
    this.swapTrack(old, track);
    await this.videoSender.replaceTrack(track);
    this.facing = next;
    this.updateCaps(track);
    this.lastApplied = null;
    this.scheduleApply();
  }

  private swapTrack(old: MediaStreamTrack, track: MediaStreamTrack): void {
    track.contentHint = 'motion';
    track.enabled = this.camOn;
    this.opts.localStream.removeTrack(old);
    this.opts.localStream.addTrack(track);
    this.opts.events.localStream(new MediaStream(this.opts.localStream.getTracks()));
  }

  get facingMode(): 'user' | 'environment' {
    return this.facing;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.statsTimer) window.clearInterval(this.statsTimer);
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    if (this.giveUpTimer) window.clearTimeout(this.giveUpTimer);
    try {
      this.dc.close();
    } catch {
      /* already closed */
    }
    this.pc.getSenders().forEach((s) => s.track?.stop());
    this.pc.close();
  }

  // ─── Wiring ────────────────────────────────────────────────────────────

  private wire(): void {
    const { events } = this.opts;

    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.opts.signal({ type: 'candidate', candidate: e.candidate.toJSON() });
    };

    // One stable MediaStream: media elements keep playing as tracks come and go;
    // the event just tells the UI to re-render (e.g. video became available).
    this.pc.ontrack = (e) => {
      e.track.onunmute = () => events.remoteStream(this.remoteStream);
      if (!this.remoteStream.getTracks().includes(e.track)) this.remoteStream.addTrack(e.track);
      events.remoteStream(this.remoteStream);
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === 'connected') {
        this.clearRecoveryTimers();
        events.link('connected');
        this.startStats();
        this.lastApplied = null;
        this.scheduleApply();
      } else if (state === 'disconnected') {
        events.link('reconnecting');
        this.armRecovery();
        this.armRestartTimer(2500);
      } else if (state === 'failed') {
        events.link('reconnecting');
        this.armRecovery();
        void this.restartIce();
      }
    };

    this.dc.onopen = () => {
      this.send({ t: 'pref', ...this.localPref });
      this.sendCaps();
      this.sendMedia();
      if (this.lastApplied) this.send({ t: 'sending', ...this.sendingInfo() });
    };

    this.dc.onmessage = (e) => {
      let msg: Control;
      try {
        msg = JSON.parse(String(e.data)) as Control;
      } catch {
        return;
      }
      switch (msg.t) {
        case 'pref':
          this.remotePref = { video: msg.video, audio: msg.audio };
          this.scheduleApply();
          break;
        case 'sending':
          events.peerSending({ video: msg.video, audio: msg.audio, auto: msg.auto, videoPaused: msg.videoPaused });
          break;
        case 'caps':
          events.peerCaps(msg.maxVideo);
          break;
        case 'media':
          events.peerMedia({ mic: msg.mic, cam: msg.cam });
          break;
      }
    };
  }

  private send(msg: Control): void {
    if (this.dc.readyState === 'open') this.dc.send(JSON.stringify(msg));
  }

  private sendMedia(): void {
    this.send({ t: 'media', mic: this.micOn, cam: this.camOn && !!this.videoSender });
  }

  private sendCaps(): void {
    this.send({ t: 'caps', maxVideo: this.videoSender ? maxLevelForCapture(this.maxShort) : null });
  }

  private updateCaps(track: MediaStreamTrack): void {
    this.maxShort = maxCaptureShortSide(track);
    this.adaptive.setMaxVideo(maxLevelForCapture(this.maxShort));
    this.sendCaps();
  }

  private async flushCandidates(): Promise<void> {
    const list = this.pendingCandidates.splice(0);
    for (const c of list) await this.pc.addIceCandidate(c).catch(() => {});
  }

  // ─── Recovery ──────────────────────────────────────────────────────────

  private armRecovery(): void {
    if (this.giveUpTimer) return;
    this.giveUpTimer = window.setTimeout(() => {
      if (this.pc.connectionState !== 'connected') this.opts.events.link('failed');
    }, RECONNECT_GIVE_UP_MS);
  }

  private clearRecoveryTimers(): void {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    if (this.giveUpTimer) window.clearTimeout(this.giveUpTimer);
    this.reconnectTimer = null;
    this.giveUpTimer = null;
  }

  /** ICE restart. Only the caller sends offers, which avoids glare entirely. */
  private async restartIce(force = false): Promise<void> {
    if (this.closed || this.pc.connectionState === 'connected') return;
    const now = Date.now();
    if (!force && now - this.lastRestartAt < 4000) return;
    this.lastRestartAt = now;
    if (this.opts.role === 'caller') {
      // 'have-local-offer' means an earlier offer was probably lost (sent to a
      // dead socket) — re-offering from that state is allowed and unwedges it.
      const state = this.pc.signalingState;
      if (state === 'stable' || state === 'have-local-offer') await this.negotiate(true).catch(() => {});
    } else {
      this.opts.signal({ type: 'restart' });
    }
    // Keep trying while the link is down.
    this.armRestartTimer(5000);
  }

  private armRestartTimer(ms: number): void {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => void this.restartIce(), ms);
  }

  /** Trigger an ICE restart (e.g. after the network interface changed). */
  kick(): void {
    if (this.pc.connectionState !== 'connected') void this.restartIce(true);
  }

  // ─── Stats & adaptation ────────────────────────────────────────────────

  private startStats(): void {
    if (this.statsTimer) return;
    this.statsTimer = window.setInterval(async () => {
      if (this.closed) return;
      try {
        const stats = await this.sampler.sample();
        this.opts.events.stats(stats);
        // Decide every 2 s so each decision sees fresh congestion feedback.
        if (++this.tick % 2 === 0 && this.pc.connectionState === 'connected') {
          this.adaptive.update(stats, !!this.videoSender);
          this.scheduleApply();
        }
      } catch {
        /* pc closed mid-sample */
      }
    }, STATS_INTERVAL_MS);
  }

  private desired(): SendingInfo {
    const a = this.adaptive.current();
    const autoVideo = this.remotePref.video === 'auto';
    let video: VideoLevelId | null = null;
    if (this.videoSender) {
      const max = maxLevelForCapture(this.maxShort);
      const pinned = autoVideo ? a.video : (this.remotePref.video as VideoLevelId);
      video = videoIndex(pinned) > videoIndex(max) ? max : pinned;
    }
    return {
      video,
      audio: this.remotePref.audio === 'auto' ? a.audio : this.remotePref.audio,
      auto: autoVideo,
      videoPaused: autoVideo && a.videoPaused,
    };
  }

  private sendingInfo(): SendingInfo {
    return this.desired();
  }

  private scheduleApply(): void {
    this.applyChain = this.applyChain.then(() => this.apply()).catch((err) => console.warn('[najik] quality apply failed', err));
  }

  private async apply(): Promise<void> {
    if (this.closed) return;
    const d = this.desired();
    const key = JSON.stringify([d, this.camOn]);
    if (key === this.lastApplied) return;

    if (this.audioSender) {
      const params = this.audioSender.getParameters();
      if (!params.encodings?.length) return; // not negotiated yet
      const enc = params.encodings[0];
      enc.maxBitrate = audioLevel(d.audio).bitrate;
      enc.priority = 'high';
      enc.networkPriority = 'high';
      await this.audioSender.setParameters(params);
    }

    if (this.videoSender && d.video) {
      const track = this.videoSender.track;
      const level = videoLevel(d.video);
      if (track) await this.ensureCapture(track, level.height);
      const short = track ? captureShortSide(track) : level.height;

      const params = this.videoSender.getParameters();
      if (!params.encodings?.length) return;
      const enc = params.encodings[0];
      enc.active = this.camOn && !d.videoPaused;
      enc.maxBitrate = level.bitrate;
      enc.maxFramerate = level.fps;
      enc.scaleResolutionDownBy = Math.max(1, short / level.height);
      enc.priority = 'medium';
      enc.networkPriority = 'low';
      // Pinned quality keeps resolution (YouTube-like); Auto trades it for smoothness.
      const withPref = { ...params, degradationPreference: d.auto ? 'balanced' : 'maintain-resolution' } as RTCRtpSendParameters;
      try {
        await this.videoSender.setParameters(withPref);
      } catch {
        // degradationPreference unsupported: retry with fresh parameters (a
        // second setParameters with the same object is rejected).
        const retry = this.videoSender.getParameters();
        if (retry.encodings?.length) {
          Object.assign(retry.encodings[0], {
            active: enc.active,
            maxBitrate: enc.maxBitrate,
            maxFramerate: enc.maxFramerate,
            scaleResolutionDownBy: enc.scaleResolutionDownBy,
            priority: enc.priority,
            networkPriority: enc.networkPriority,
          });
          await this.videoSender.setParameters(retry);
        }
      }
    }

    this.lastApplied = key;
    this.opts.events.localSending(d);
    this.send({ t: 'sending', ...d });
  }

  /** Raise camera capture when a higher level is requested; lower it to save CPU. */
  private async ensureCapture(track: MediaStreamTrack, targetShort: number): Promise<void> {
    const short = captureShortSide(track);
    let want = short;
    if (targetShort > short + 8 && short < this.maxShort) want = Math.min(targetShort, this.maxShort);
    else if (short >= 1000 && targetShort <= 480) want = 720;
    if (want === short) return;
    try {
      await track.applyConstraints(videoConstraints(this.facing, want));
    } catch {
      /* keep current capture */
    }
  }
}
