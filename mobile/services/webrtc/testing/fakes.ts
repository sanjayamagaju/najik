/* Test doubles for the WebRTC engine (used by unit tests; never imported by app code). */
import type { Timers } from '../PeerSession';
import type {
  IceCandidateInit,
  MediaStreamLike,
  MediaTrackLike,
  PeerConnectionLike,
  RtpSenderLike,
  SendParametersLike,
  SessionDescriptionInit,
} from '../types';

/** Deterministic timers: nothing fires until `advance()`. */
export class ManualTimers implements Timers {
  private time = 1_000_000;
  private seq = 0;
  private tasks = new Map<number, { at: number; fn: () => void }>();

  now = (): number => this.time;

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.tasks.set(id, { at: this.time + Math.max(0, ms), fn });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.tasks.delete(handle as number);
  };

  get pending(): number {
    return this.tasks.size;
  }

  /** Advance the clock, firing due tasks in order (tasks scheduled while firing included). */
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Infinity;
      for (const [id, task] of this.tasks) {
        if (task.at <= target && task.at < nextAt) {
          nextAt = task.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const task = this.tasks.get(nextId)!;
      this.tasks.delete(nextId);
      this.time = task.at;
      task.fn();
      await flush();
    }
    this.time = target;
    await flush();
  }
}

/** Let pending promise chains settle. */
export async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

export class FakeTrack implements MediaTrackLike {
  enabled = true;
  readyState = 'live';
  stopped = false;
  facing: string;
  constructor(
    readonly id: string,
    readonly kind: string,
    private settings: { width?: number; height?: number; frameRate?: number } = {},
  ) {
    this.facing = 'user';
  }
  stop(): void {
    this.stopped = true;
  }
  getSettings() {
    return { ...this.settings, facingMode: this.facing };
  }
  async applyConstraints(c: Record<string, unknown>): Promise<void> {
    if (typeof c.facingMode === 'string') this.facing = c.facingMode;
  }
}

export class FakeStream implements MediaStreamLike {
  released = false;
  constructor(
    readonly id: string,
    private readonly tracks: FakeTrack[],
  ) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  toURL() {
    return `stream://${this.id}`;
  }
  release() {
    this.released = true;
  }
}

export function fakeLocalStream(video: boolean): FakeStream {
  const tracks = [new FakeTrack('a1', 'audio')];
  if (video) tracks.push(new FakeTrack('v1', 'video', { width: 1280, height: 720, frameRate: 30 }));
  return new FakeStream('local', tracks);
}

export class FakeSender implements RtpSenderLike {
  params: SendParametersLike = { encodings: [{ active: true }], degradationPreference: null };
  readonly applied: SendParametersLike[] = [];
  constructor(readonly track: MediaTrackLike | null) {}
  getParameters(): SendParametersLike {
    return JSON.parse(JSON.stringify(this.params)) as SendParametersLike;
  }
  async setParameters(params: SendParametersLike): Promise<void> {
    this.params = params;
    this.applied.push(params);
  }
}

type Listener = (event: never) => void;

export class FakePeerConnection implements PeerConnectionLike {
  static instances: FakePeerConnection[] = [];

  signalingState = 'stable';
  iceConnectionState = 'new';
  connectionState = 'new';
  remoteDescription: SessionDescriptionInit | null = null;
  localDescription: SessionDescriptionInit | null = null;
  closed = false;
  /** Ordered log of negotiation calls, for ordering assertions. */
  readonly log: string[] = [];
  readonly candidates: IceCandidateInit[] = [];
  readonly senders: FakeSender[] = [];
  configuration: Record<string, unknown> | null = null;
  statsReport: unknown = new Map();
  private offers = 0;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(readonly config: Record<string, unknown>) {
    FakePeerConnection.instances.push(this);
  }

  addTrack(track: MediaTrackLike): RtpSenderLike {
    const sender = new FakeSender(track);
    this.senders.push(sender);
    return sender;
  }

  getSenders(): RtpSenderLike[] {
    return this.senders;
  }

  async createOffer(options?: { iceRestart?: boolean }): Promise<SessionDescriptionInit> {
    this.offers += 1;
    const restart = options?.iceRestart === true;
    this.log.push(restart ? 'createOffer(restart)' : 'createOffer');
    return {
      type: 'offer',
      sdp: `v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10\r\na=x-offer:${this.offers}${restart ? ':restart' : ''}\r\n`,
    };
  }

  async createAnswer(): Promise<SessionDescriptionInit> {
    this.log.push('createAnswer');
    return { type: 'answer', sdp: 'v=0\r\na=x-answer\r\n' };
  }

  async setLocalDescription(desc: SessionDescriptionInit): Promise<void> {
    this.log.push(`setLocal:${desc.type}`);
    if (desc.type === 'rollback') {
      this.signalingState = 'stable';
      return;
    }
    this.localDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
  }

  async setRemoteDescription(desc: SessionDescriptionInit): Promise<void> {
    this.log.push(`setRemote:${desc.type}`);
    this.remoteDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate(candidate: IceCandidateInit): Promise<void> {
    if (!this.remoteDescription) throw new Error('InvalidStateError: no remote description');
    this.log.push(`addIce:${candidate.candidate}`);
    this.candidates.push(candidate);
  }

  setConfiguration(config: Record<string, unknown>): void {
    this.configuration = config;
  }

  async getStats(): Promise<unknown> {
    return this.statsReport;
  }

  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  emit(type: string, event: unknown = {}): void {
    for (const l of this.listeners.get(type) ?? []) (l as (e: unknown) => void)(event);
  }

  setIceState(state: string): void {
    this.iceConnectionState = state;
    this.emit('iceconnectionstatechange');
  }

  emitLocalCandidate(candidate: string, usernameFragment?: string): void {
    this.emit('icecandidate', {
      candidate: { candidate, sdpMid: '0', sdpMLineIndex: 0, usernameFragment },
    });
  }

  emitRemoteTrack(stream: MediaStreamLike): void {
    const track = stream.getTracks()[0];
    this.emit('track', { track, streams: [stream] });
  }
}
