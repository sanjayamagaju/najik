import type { QualityLimitationReason, QualitySample } from '../quality/QualityController';

/**
 * Pure `getStats()` → normalized metrics. Works on the plain stats dictionaries libwebrtc
 * produces (react-native-webrtc resolves `getStats()` with a Map of id → stats object).
 * Rates (bitrates, loss) are deltas against the previous call's cursor.
 */

export type RawStat = Record<string, unknown> & { id?: string; type?: string; timestamp?: number };

export type StatsInput =
  | ReadonlyMap<string, RawStat>
  | Iterable<RawStat>
  | Record<string, RawStat>
  | { forEach: (cb: (value: RawStat) => void) => void };

export interface NormalizedStats {
  timestamp: number;
  rttMs: number | null;
  /** Uplink bandwidth estimate (bps). */
  availableOutgoingBitrate: number | null;
  /** Downlink loss we observe on inbound RTP, percent. */
  inboundLossPct: number | null;
  /** Uplink loss reported back by the peer (remote-inbound-rtp), percent. */
  outboundLossPct: number | null;
  /** Inbound jitter (max of audio/video), ms. */
  jitterMs: number | null;
  outboundKbps: number | null;
  inboundKbps: number | null;
  outboundVideo: { width: number | null; height: number | null; fps: number | null } | null;
  inboundVideo: { width: number | null; height: number | null; fps: number | null } | null;
  qualityLimitationReason: QualityLimitationReason | null;
  /** 'relay' when traffic goes through TURN. */
  localCandidateType: string | null;
}

export interface StatsCursor {
  timestamp: number;
  bytesSent: number;
  bytesReceived: number;
  packetsLost: number;
  packetsReceived: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function statsToArray(input: StatsInput): RawStat[] {
  const out: RawStat[] = [];
  if (!input) return out;
  if (typeof (input as Map<string, RawStat>).values === 'function' && input instanceof Map) {
    for (const v of input.values()) out.push(v);
    return out;
  }
  if (typeof (input as { forEach?: unknown }).forEach === 'function') {
    (input as { forEach: (cb: (value: RawStat) => void) => void }).forEach((v) => out.push(v));
    return out;
  }
  if (Symbol.iterator in (input as object)) {
    for (const v of input as Iterable<RawStat>) out.push(v);
    return out;
  }
  return Object.values(input as Record<string, RawStat>);
}

function kindOf(stat: RawStat): string | null {
  return str(stat.kind) ?? str(stat.mediaType);
}

function selectedPair(stats: RawStat[], byId: Map<string, RawStat>): RawStat | null {
  for (const s of stats) {
    if (s.type === 'transport' && typeof s.selectedCandidatePairId === 'string') {
      const pair = byId.get(s.selectedCandidatePairId);
      if (pair) return pair;
    }
  }
  const pairs = stats.filter((s) => s.type === 'candidate-pair');
  return (
    pairs.find((p) => p.selected === true) ??
    pairs.find((p) => p.nominated === true && p.state === 'succeeded') ??
    null
  );
}

const LIMITATION: Record<string, QualityLimitationReason> = {
  none: 'none',
  bandwidth: 'bandwidth',
  cpu: 'cpu',
  other: 'other',
};

const round1 = (v: number) => Math.round(v * 10) / 10;

export function normalizeStats(
  input: StatsInput,
  prev: StatsCursor | null,
  nowMs: number,
): { stats: NormalizedStats; cursor: StatsCursor } {
  const all = statsToArray(input);
  const byId = new Map<string, RawStat>();
  for (const s of all) if (typeof s.id === 'string') byId.set(s.id, s);

  const pair = selectedPair(all, byId);
  let rttMs: number | null = null;
  let availableOutgoingBitrate: number | null = null;
  let localCandidateType: string | null = null;
  if (pair) {
    const rtt = num(pair.currentRoundTripTime);
    if (rtt !== null) rttMs = rtt * 1000;
    availableOutgoingBitrate = num(pair.availableOutgoingBitrate);
    const local =
      typeof pair.localCandidateId === 'string' ? byId.get(pair.localCandidateId) : null;
    localCandidateType = local ? (str(local.candidateType) ?? str(local.type)) : null;
    if (localCandidateType === 'local-candidate') localCandidateType = null;
  }

  let bytesSent = 0;
  let bytesReceived = 0;
  let packetsLost = 0;
  let packetsReceived = 0;
  let jitterMs: number | null = null;
  let outboundVideo: NormalizedStats['outboundVideo'] = null;
  let inboundVideo: NormalizedStats['inboundVideo'] = null;
  let qualityLimitationReason: QualityLimitationReason | null = null;
  let remoteFractionLost: number | null = null;
  let remoteRttMs: number | null = null;

  for (const s of all) {
    const kind = kindOf(s);
    switch (s.type) {
      case 'outbound-rtp': {
        bytesSent += num(s.bytesSent) ?? 0;
        if (kind === 'video') {
          outboundVideo = {
            width: num(s.frameWidth),
            height: num(s.frameHeight),
            fps: num(s.framesPerSecond),
          };
          const reason = str(s.qualityLimitationReason);
          if (reason) qualityLimitationReason = LIMITATION[reason] ?? 'other';
        }
        break;
      }
      case 'inbound-rtp': {
        bytesReceived += num(s.bytesReceived) ?? 0;
        packetsLost += Math.max(0, num(s.packetsLost) ?? 0);
        packetsReceived += num(s.packetsReceived) ?? 0;
        const jitter = num(s.jitter);
        if (jitter !== null) jitterMs = Math.max(jitterMs ?? 0, jitter * 1000);
        if (kind === 'video') {
          inboundVideo = {
            width: num(s.frameWidth),
            height: num(s.frameHeight),
            fps: num(s.framesPerSecond),
          };
        }
        break;
      }
      case 'remote-inbound-rtp': {
        const fraction = num(s.fractionLost);
        if (fraction !== null) remoteFractionLost = Math.max(remoteFractionLost ?? 0, fraction);
        const rtt = num(s.roundTripTime);
        if (rtt !== null) remoteRttMs = Math.max(remoteRttMs ?? 0, rtt * 1000);
        break;
      }
      default:
        break;
    }
  }

  // Use the stats' own clock when present so deltas are exact.
  const timestamps = all.map((s) => num(s.timestamp)).filter((t): t is number => t !== null);
  const timestamp = timestamps.length > 0 ? Math.max(...timestamps) : nowMs;

  let outboundKbps: number | null = null;
  let inboundKbps: number | null = null;
  let inboundLossPct: number | null = null;
  if (prev) {
    const dtSec = (timestamp - prev.timestamp) / 1000;
    if (dtSec > 0) {
      const sent = bytesSent - prev.bytesSent;
      const received = bytesReceived - prev.bytesReceived;
      // Counters reset after an ICE restart / track swap: skip the negative delta.
      if (sent >= 0) outboundKbps = round1((sent * 8) / 1000 / dtSec);
      if (received >= 0) inboundKbps = round1((received * 8) / 1000 / dtSec);
    }
    const lost = packetsLost - prev.packetsLost;
    const got = packetsReceived - prev.packetsReceived;
    if (lost >= 0 && got >= 0 && lost + got > 0)
      inboundLossPct = round1((lost / (lost + got)) * 100);
  }

  return {
    stats: {
      timestamp,
      rttMs: rttMs ?? remoteRttMs,
      availableOutgoingBitrate,
      inboundLossPct,
      outboundLossPct: remoteFractionLost === null ? null : round1(remoteFractionLost * 100),
      jitterMs: jitterMs === null ? null : round1(jitterMs),
      outboundKbps,
      inboundKbps,
      outboundVideo,
      inboundVideo,
      qualityLimitationReason,
      localCandidateType,
    },
    cursor: { timestamp, bytesSent, bytesReceived, packetsLost, packetsReceived },
  };
}

/** Uplink view used by the QualityController. */
export function toQualitySample(stats: NormalizedStats): QualitySample {
  return {
    availableOutgoingBitrate: stats.availableOutgoingBitrate,
    rttMs: stats.rttMs,
    lossPct: stats.outboundLossPct,
    jitterMs: null, // inbound jitter describes the peer's uplink, not ours
    qualityLimitationReason: stats.qualityLimitationReason,
  };
}

/** 0 (unusable) … 4 (excellent) for the signal-bars indicator. Uses what *we* experience. */
export function networkQualityLevel(stats: NormalizedStats | null): 0 | 1 | 2 | 3 | 4 {
  if (!stats) return 4;
  const rtt = stats.rttMs ?? 0;
  const loss = Math.max(stats.inboundLossPct ?? 0, stats.outboundLossPct ?? 0);
  const jitter = stats.jitterMs ?? 0;
  if (loss >= 20 || rtt >= 1500) return 0;
  if (loss >= 10 || rtt >= 800 || jitter >= 100) return 1;
  if (loss >= 4 || rtt >= 400 || jitter >= 50) return 2;
  if (loss >= 1.5 || rtt >= 200 || jitter >= 30) return 3;
  return 4;
}
