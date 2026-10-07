import type { AudioQualityPref, VideoQualityPref } from '@/types/protocol';

import {
  type AudioPreset,
  audioRank,
  audioSpec,
  minAudioPreset,
  minVideoTier,
  nextAudioDown,
  nextAudioUp,
  nextVideoTierDown,
  nextVideoTierUp,
  scaleDownFor,
  tierForBitrate,
  tierForHeight,
  type VideoTier,
  videoRank,
  videoSpec,
} from './ladder';

/**
 * Pure, deterministic send-side quality controller (docs/ARCHITECTURE.md "Adaptive quality").
 *
 * Inputs: normalized uplink samples (every ~2 s), device/capture caps and the peer's requested
 * caps (`call.signal{type:"quality"}`). Output: the encoding parameters to apply with
 * `RTCRtpSender.setParameters` — no renegotiation.
 *
 * Policy:
 *  - **Auto** (peer requested "auto"): downgrade fast (2 bad samples in a row), upgrade slowly
 *    (10 good samples in a row AND available outgoing bitrate ≥ 1.3× the next tier's bitrate).
 *  - **Manual cap** (peer picked e.g. 720p): send exactly that (bounded by device/capture caps),
 *    hold it through ordinary congestion, and only undercut it under *severe* congestion so the
 *    call never freezes. While undercut, `autoLimited` is true. Recovery uses the upgrade rule.
 *  - The applied tier is always ≤ min(peer cap, device cap, capture cap).
 *
 * No timers, no randomness, no I/O: every decision is a function of the sample sequence.
 */

export type QualityLimitationReason = 'none' | 'bandwidth' | 'cpu' | 'other';

export interface QualitySample {
  /** Bandwidth estimate for the selected candidate pair, bps. */
  availableOutgoingBitrate: number | null;
  rttMs: number | null;
  /** Uplink loss as reported by the peer (remote-inbound-rtp), percent 0–100. */
  lossPct: number | null;
  jitterMs: number | null;
  qualityLimitationReason: QualityLimitationReason | null;
}

export type SampleGrade = 'good' | 'neutral' | 'bad' | 'severe';

export interface QualityThresholds {
  badLossPct: number;
  severeLossPct: number;
  goodLossPct: number;
  badRttMs: number;
  severeRttMs: number;
  goodRttMs: number;
  badJitterMs: number;
  /** available < factor × current tier bitrate ⇒ bad / severe. */
  badBitrateFactor: number;
  severeBitrateFactor: number;
}

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  badLossPct: 5,
  severeLossPct: 15,
  goodLossPct: 2,
  badRttMs: 450,
  severeRttMs: 1000,
  goodRttMs: 250,
  badJitterMs: 80,
  badBitrateFactor: 0.85,
  severeBitrateFactor: 0.5,
};

/** Bitrate (bps) an audio preset needs to be sustainable; below it the preset is "bad". */
const AUDIO_NEEDS: Record<AudioPreset, number> = { high: 250_000, medium: 100_000, low: 0 };
const AUDIO_SEVERE_BITRATE = 60_000;
const AUDIO_BAD_LOSS = 10;
const AUDIO_SEVERE_LOSS = 20;
const AUDIO_GOOD_LOSS = 3;

export interface QualityControllerOptions {
  /** Device-class cap (low-end devices → 480p). */
  deviceCap?: VideoTier;
  /** Height in px of the camera capture (the short edge). */
  captureHeight?: number;
  /** Starting tier for Auto (clamped to the caps). Defaults to 720p. */
  initialVideo?: VideoTier;
  initialAudio?: AudioPreset;
  downgradeAfter?: number;
  upgradeAfter?: number;
  upgradeHeadroom?: number;
  /** Bitrate-based badness is ignored for the first N samples while BWE ramps up. */
  warmupSamples?: number;
  thresholds?: Partial<QualityThresholds>;
}

export interface VideoEncoding {
  tier: VideoTier;
  maxBitrate: number;
  maxFramerate: number;
  scaleResolutionDownBy: number;
}

export interface AudioEncoding {
  preset: AudioPreset;
  maxBitrate: number;
  dtx: boolean;
  fec: boolean;
}

export interface QualityDecision {
  video: VideoEncoding;
  audio: AudioEncoding;
  /** min(device cap, capture cap, peer video cap). */
  videoCap: VideoTier;
  audioCap: AudioPreset;
  remoteVideoPref: VideoQualityPref;
  remoteAudioPref: AudioQualityPref;
  /** A manual cap requested by the peer is being undercut because of congestion. */
  autoLimited: boolean;
  audioAutoLimited: boolean;
  /** Grade of the last sample (null before the first sample). */
  lastGrade: SampleGrade | null;
}

export class QualityController {
  private readonly downgradeAfter: number;
  private readonly upgradeAfter: number;
  private readonly headroom: number;
  private readonly warmup: number;
  private readonly t: QualityThresholds;

  private deviceCap: VideoTier;
  private captureHeight: number;
  private remoteVideo: VideoQualityPref = 'auto';
  private remoteAudio: AudioQualityPref = 'auto';
  private videoActive = true;

  private tier: VideoTier;
  private audio: AudioPreset;

  private samples = 0;
  private badStreak = 0;
  private severeStreak = 0;
  private goodStreak = 0;
  private audioBadStreak = 0;
  private audioSevereStreak = 0;
  private audioGoodStreak = 0;
  private lastGrade: SampleGrade | null = null;
  private tierChanges = 0;

  constructor(options: QualityControllerOptions = {}) {
    this.downgradeAfter = options.downgradeAfter ?? 2;
    this.upgradeAfter = options.upgradeAfter ?? 10;
    this.headroom = options.upgradeHeadroom ?? 1.3;
    this.warmup = options.warmupSamples ?? 3;
    this.t = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
    this.deviceCap = options.deviceCap ?? '1080p';
    this.captureHeight = options.captureHeight ?? 720;
    this.tier = minVideoTier(options.initialVideo ?? '720p', this.videoCap());
    this.audio = options.initialAudio ?? 'high';
  }

  // ───────────────────────── caps ─────────────────────────

  /** min(device, capture, peer request). */
  videoCap(): VideoTier {
    const caps: VideoTier[] = [this.deviceCap, tierForHeight(this.captureHeight) ?? '1080p'];
    if (this.remoteVideo !== 'auto') caps.push(this.remoteVideo);
    return minVideoTier(...caps);
  }

  audioCap(): AudioPreset {
    return this.remoteAudio === 'auto' ? 'high' : this.remoteAudio;
  }

  private hardVideoCap(): VideoTier {
    return minVideoTier(this.deviceCap, tierForHeight(this.captureHeight) ?? '1080p');
  }

  setDeviceCap(cap: VideoTier): QualityDecision {
    this.deviceCap = cap;
    this.clampVideo();
    return this.decision();
  }

  setCaptureHeight(height: number): QualityDecision {
    if (height > 0) this.captureHeight = height;
    this.clampVideo();
    return this.decision();
  }

  /** Camera off / audio-only: video grading pauses (BWE without video says nothing about it). */
  setVideoActive(active: boolean): void {
    if (this.videoActive === active) return;
    this.videoActive = active;
    this.badStreak = 0;
    this.severeStreak = 0;
    this.goodStreak = 0;
  }

  /**
   * The peer's `quality` signal. A manual video cap jumps straight to the requested tier
   * (bounded by device/capture); "auto" keeps the current tier and resumes Auto.
   */
  setRemotePreference(video: VideoQualityPref, audio: AudioQualityPref): QualityDecision {
    const videoChanged = video !== this.remoteVideo;
    const audioChanged = audio !== this.remoteAudio;
    this.remoteVideo = video;
    this.remoteAudio = audio;
    if (videoChanged) {
      this.resetVideoStreaks();
      if (video !== 'auto') this.setTier(this.videoCap());
      else this.clampVideo();
    }
    if (audioChanged) {
      this.resetAudioStreaks();
      if (audio !== 'auto') this.audio = audio;
    }
    return this.decision();
  }

  // ───────────────────────── samples ─────────────────────────

  grade(sample: QualitySample): SampleGrade {
    const t = this.t;
    const inWarmup = this.samples <= this.warmup;
    const bitrate = videoSpec(this.tier).maxBitrate;
    const avail = sample.availableOutgoingBitrate;
    const loss = sample.lossPct;
    const rtt = sample.rttMs;

    if (
      (loss !== null && loss >= t.severeLossPct) ||
      (rtt !== null && rtt >= t.severeRttMs) ||
      (!inWarmup && avail !== null && avail < bitrate * t.severeBitrateFactor)
    ) {
      return 'severe';
    }
    if (
      (loss !== null && loss >= t.badLossPct) ||
      (rtt !== null && rtt >= t.badRttMs) ||
      (sample.jitterMs !== null && sample.jitterMs >= t.badJitterMs) ||
      sample.qualityLimitationReason === 'bandwidth' ||
      sample.qualityLimitationReason === 'cpu' ||
      (!inWarmup && avail !== null && avail < bitrate * t.badBitrateFactor)
    ) {
      return 'bad';
    }
    if (
      (loss === null || loss < t.goodLossPct) &&
      (rtt === null || rtt < t.goodRttMs) &&
      (sample.qualityLimitationReason === null || sample.qualityLimitationReason === 'none')
    ) {
      return 'good';
    }
    return 'neutral';
  }

  addSample(sample: QualitySample): QualityDecision {
    this.samples += 1;
    if (this.videoActive) this.stepVideo(sample);
    this.stepAudio(sample);
    return this.decision();
  }

  private stepVideo(sample: QualitySample): void {
    const grade = this.grade(sample);
    this.lastGrade = grade;
    const manual = this.remoteVideo !== 'auto';

    if (grade === 'severe') {
      this.severeStreak += 1;
      this.badStreak += 1;
      this.goodStreak = 0;
    } else if (grade === 'bad') {
      this.severeStreak = 0;
      this.badStreak += 1;
      this.goodStreak = 0;
    } else if (grade === 'good') {
      this.severeStreak = 0;
      this.badStreak = 0;
      this.goodStreak += 1;
    } else {
      this.severeStreak = 0;
      this.badStreak = 0;
      this.goodStreak = 0;
    }

    // Manual caps are held through ordinary congestion and only undercut when severe.
    const shouldDrop = manual
      ? this.severeStreak >= this.downgradeAfter
      : this.badStreak >= this.downgradeAfter;

    if (shouldDrop) {
      let next = nextVideoTierDown(this.tier) ?? this.tier;
      const avail = sample.availableOutgoingBitrate;
      if (this.severeStreak >= this.downgradeAfter && avail !== null) {
        // Jump straight to what fits (with margin) instead of walking down one tier per 4 s.
        next = minVideoTier(next, tierForBitrate(avail * this.t.badBitrateFactor));
      }
      this.setTier(next);
      this.resetVideoStreaks();
      return;
    }

    if (this.goodStreak >= this.upgradeAfter) {
      const up = nextVideoTierUp(this.tier);
      const cap = this.videoCap();
      const avail = sample.availableOutgoingBitrate;
      if (
        up !== null &&
        videoRank(up) <= videoRank(cap) &&
        avail !== null &&
        avail >= videoSpec(up).maxBitrate * this.headroom
      ) {
        this.setTier(up);
        this.resetVideoStreaks();
      }
      // Without headroom we keep the streak: the next good sample with headroom upgrades.
    }
  }

  private stepAudio(sample: QualitySample): void {
    const avail = sample.availableOutgoingBitrate;
    const loss = sample.lossPct;
    const manual = this.remoteAudio !== 'auto';
    const severe =
      (avail !== null && this.samples > this.warmup && avail < AUDIO_SEVERE_BITRATE) ||
      (loss !== null && loss >= AUDIO_SEVERE_LOSS);
    const bad =
      severe ||
      (avail !== null && this.samples > this.warmup && avail < AUDIO_NEEDS[this.audio]) ||
      (loss !== null && loss >= AUDIO_BAD_LOSS);
    const good = !bad && (loss === null || loss < AUDIO_GOOD_LOSS);

    this.audioSevereStreak = severe ? this.audioSevereStreak + 1 : 0;
    this.audioBadStreak = bad ? this.audioBadStreak + 1 : 0;
    this.audioGoodStreak = good ? this.audioGoodStreak + 1 : 0;

    const drop = manual
      ? this.audioSevereStreak >= this.downgradeAfter
      : this.audioBadStreak >= this.downgradeAfter;
    if (drop) {
      const down = nextAudioDown(this.audio);
      if (down) this.audio = down;
      this.resetAudioStreaks();
      return;
    }
    if (this.audioGoodStreak >= this.upgradeAfter) {
      const up = nextAudioUp(this.audio);
      if (
        up !== null &&
        audioRank(up) <= audioRank(this.audioCap()) &&
        avail !== null &&
        avail >= AUDIO_NEEDS[up] * this.headroom
      ) {
        this.audio = up;
        this.resetAudioStreaks();
      }
    }
  }

  // ───────────────────────── output ─────────────────────────

  decision(): QualityDecision {
    const cap = this.videoCap();
    const tier = minVideoTier(this.tier, cap);
    const spec = videoSpec(tier);
    const audio = minAudioPreset(this.audio, this.audioCap());
    const aSpec = audioSpec(audio);
    return {
      video: {
        tier,
        maxBitrate: spec.maxBitrate,
        maxFramerate: spec.fps,
        scaleResolutionDownBy: scaleDownFor(tier, this.captureHeight),
      },
      audio: { preset: audio, maxBitrate: aSpec.maxBitrate, dtx: aSpec.dtx, fec: aSpec.fec },
      videoCap: cap,
      audioCap: this.audioCap(),
      remoteVideoPref: this.remoteVideo,
      remoteAudioPref: this.remoteAudio,
      autoLimited: this.remoteVideo !== 'auto' && videoRank(tier) < videoRank(cap),
      audioAutoLimited:
        this.remoteAudio !== 'auto' && audioRank(audio) < audioRank(this.audioCap()),
      lastGrade: this.lastGrade,
    };
  }

  /** Number of applied video tier changes so far (call metrics). */
  get videoTierChanges(): number {
    return this.tierChanges;
  }

  private setTier(next: VideoTier): void {
    const bounded = minVideoTier(next, this.videoCap());
    if (bounded !== this.tier) this.tierChanges += 1;
    this.tier = bounded;
  }

  private clampVideo(): void {
    const cap = this.remoteVideo === 'auto' ? this.hardVideoCap() : this.videoCap();
    if (videoRank(this.tier) > videoRank(cap)) this.setTier(cap);
  }

  private resetVideoStreaks(): void {
    this.badStreak = 0;
    this.severeStreak = 0;
    this.goodStreak = 0;
  }

  private resetAudioStreaks(): void {
    this.audioBadStreak = 0;
    this.audioSevereStreak = 0;
    this.audioGoodStreak = 0;
  }
}
