import type { AudioQualityPref, CallMetricsBody, VideoQualityPref } from '@/types/protocol';

import type { NormalizedStats } from './normalizeStats';

/**
 * Accumulates normalized samples into the `POST /calls/{id}/metrics` summary. Pure: callers
 * pass in everything (no clocks, no NetInfo).
 */

interface Mean {
  sum: number;
  n: number;
}

const add = (m: Mean, v: number | null): void => {
  if (v === null || !Number.isFinite(v)) return;
  m.sum += v;
  m.n += 1;
};

const avg = (m: Mean, digits = 1): number | null => {
  if (m.n === 0) return null;
  const p = 10 ** digits;
  return Math.round((m.sum / m.n) * p) / p;
};

export class MetricsAggregator {
  private rtt: Mean = { sum: 0, n: 0 };
  private jitter: Mean = { sum: 0, n: 0 };
  private loss: Mean = { sum: 0, n: 0 };
  private up: Mean = { sum: 0, n: 0 };
  private down: Mean = { sum: 0, n: 0 };
  private reconnects = 0;
  private qualityChanges = 0;

  get sampleCount(): number {
    return Math.max(this.rtt.n, this.up.n, this.down.n);
  }

  addSample(stats: NormalizedStats): void {
    add(this.rtt, stats.rttMs);
    add(this.jitter, stats.jitterMs);
    // Loss as experienced by this participant (downlink), falling back to the uplink report.
    add(this.loss, stats.inboundLossPct ?? stats.outboundLossPct);
    add(this.up, stats.outboundKbps);
    add(this.down, stats.inboundKbps);
  }

  recordReconnect(): void {
    this.reconnects += 1;
  }

  recordVideoQualityChange(count = 1): void {
    this.qualityChanges += count;
  }

  summary(params: {
    durationSec: number;
    networkType: string;
    selectedVideo: VideoQualityPref;
    selectedAudio: AudioQualityPref;
  }): CallMetricsBody {
    return {
      rtt_ms_avg: avg(this.rtt),
      jitter_ms_avg: avg(this.jitter),
      packet_loss_pct_avg: clampPct(avg(this.loss, 2)),
      bitrate_kbps_avg_up: avg(this.up),
      bitrate_kbps_avg_down: avg(this.down),
      video_quality_changes: this.qualityChanges,
      reconnects: this.reconnects,
      duration_sec: Math.max(0, Math.round(params.durationSec)),
      // Backend limit: 16 chars.
      network_type: params.networkType.slice(0, 16),
      selected_video_quality: params.selectedVideo,
      selected_audio_quality: params.selectedAudio,
    };
  }
}

function clampPct(v: number | null): number | null {
  if (v === null) return null;
  return Math.min(100, Math.max(0, v));
}
