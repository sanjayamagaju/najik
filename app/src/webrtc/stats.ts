export interface StreamStats {
  kbps: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
}

export interface CallStats {
  at: number;
  /** Round-trip time on the selected candidate pair, ms. */
  rttMs: number | null;
  /** Sender-side bandwidth estimate (Chrome/Android WebView), kbps. */
  availableOutKbps: number | null;
  /** Fraction (0–1) of our packets the peer reports lost (RTCP). */
  outLoss: number;
  /** Fraction (0–1) of packets we lost receiving from the peer. */
  inLoss: number;
  jitterMs: number | null;
  qualityLimitation: 'none' | 'cpu' | 'bandwidth' | 'other';
  relayed: boolean;
  outVideo: StreamStats | null;
  inVideo: StreamStats | null;
  outAudio: StreamStats | null;
  inAudio: StreamStats | null;
}

interface Prev {
  bytes: Map<string, { bytes: number; ts: number }>;
  inPackets: { received: number; lost: number } | null;
}

type AnyStats = Record<string, unknown> & { type: string; id: string; timestamp: number };

/** Samples RTCPeerConnection.getStats() and turns cumulative counters into rates. */
export class StatsSampler {
  private prev: Prev = { bytes: new Map(), inPackets: null };

  constructor(private pc: RTCPeerConnection) {}

  private rate(id: string, bytes: number, ts: number): number {
    const p = this.prev.bytes.get(id);
    this.prev.bytes.set(id, { bytes, ts });
    if (!p || ts <= p.ts) return 0;
    return Math.max(0, ((bytes - p.bytes) * 8) / (ts - p.ts)); // bits per ms == kbps
  }

  async sample(): Promise<CallStats> {
    const report = await this.pc.getStats();
    const all = new Map<string, AnyStats>();
    report.forEach((s: AnyStats) => all.set(s.id, s));

    const out: CallStats = {
      at: Date.now(),
      rttMs: null,
      availableOutKbps: null,
      outLoss: 0,
      inLoss: 0,
      jitterMs: null,
      qualityLimitation: 'none',
      relayed: false,
      outVideo: null,
      inVideo: null,
      outAudio: null,
      inAudio: null,
    };

    const codecName = (id: unknown) => {
      const c = typeof id === 'string' ? all.get(id) : undefined;
      return typeof c?.mimeType === 'string' ? c.mimeType.split('/')[1] : undefined;
    };

    let inReceived = 0;
    let inLost = 0;
    let remoteLossSum = 0;
    let remoteLossN = 0;

    for (const s of all.values()) {
      const num = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : undefined);

      if (s.type === 'candidate-pair' && (s.nominated || s.selected) && s.state === 'succeeded') {
        const rtt = num('currentRoundTripTime');
        if (rtt !== undefined) out.rttMs = Math.round(rtt * 1000);
        const bwe = num('availableOutgoingBitrate');
        if (bwe !== undefined) out.availableOutKbps = Math.round(bwe / 1000);
        const local = all.get(String(s.localCandidateId));
        const remote = all.get(String(s.remoteCandidateId));
        out.relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
      }

      if (s.type === 'outbound-rtp' && !s.isRemote) {
        const kbps = this.rate(s.id, num('bytesSent') ?? 0, s.timestamp);
        if (s.kind === 'video') {
          out.outVideo = {
            kbps: Math.round(kbps),
            width: num('frameWidth'),
            height: num('frameHeight'),
            fps: num('framesPerSecond'),
            codec: codecName(s.codecId),
          };
          const lim = s.qualityLimitationReason;
          if (lim === 'cpu' || lim === 'bandwidth' || lim === 'other') out.qualityLimitation = lim;
        } else if (s.kind === 'audio') {
          out.outAudio = { kbps: Math.round(kbps), codec: codecName(s.codecId) };
        }
      }

      if (s.type === 'inbound-rtp') {
        const kbps = this.rate(s.id, num('bytesReceived') ?? 0, s.timestamp);
        inReceived += num('packetsReceived') ?? 0;
        inLost += Math.max(0, num('packetsLost') ?? 0);
        const jitter = num('jitter');
        if (jitter !== undefined && s.kind === 'audio') out.jitterMs = Math.round(jitter * 1000);
        if (s.kind === 'video') {
          out.inVideo = {
            kbps: Math.round(kbps),
            width: num('frameWidth'),
            height: num('frameHeight'),
            fps: num('framesPerSecond'),
            codec: codecName(s.codecId),
          };
        } else if (s.kind === 'audio') {
          out.inAudio = { kbps: Math.round(kbps), codec: codecName(s.codecId) };
        }
      }

      if (s.type === 'remote-inbound-rtp') {
        const fl = num('fractionLost');
        if (fl !== undefined) {
          remoteLossSum += fl;
          remoteLossN++;
        }
        if (out.rttMs === null) {
          const rtt = num('roundTripTime');
          if (rtt !== undefined) out.rttMs = Math.round(rtt * 1000);
        }
      }
    }

    out.outLoss = remoteLossN ? remoteLossSum / remoteLossN : 0;

    // Inbound loss over the last interval (not since call start).
    const prev = this.prev.inPackets;
    this.prev.inPackets = { received: inReceived, lost: inLost };
    if (prev) {
      const dRecv = inReceived - prev.received;
      const dLost = inLost - prev.lost;
      out.inLoss = dRecv + dLost > 0 ? Math.max(0, dLost) / (dRecv + dLost) : 0;
    }

    return out;
  }
}

/** 0–4 signal bars from round-trip time and loss in both directions. */
export function networkScore(s: CallStats | null): number {
  if (!s) return 4;
  const loss = Math.max(s.outLoss, s.inLoss);
  const rtt = s.rttMs ?? 0;
  if (loss > 0.15 || rtt > 800) return 1;
  if (loss > 0.07 || rtt > 450) return 2;
  if (loss > 0.025 || rtt > 250) return 3;
  return 4;
}
