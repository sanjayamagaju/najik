import type { CallStats } from './stats';
import { AUDIO_LEVELS, VIDEO_LEVELS, videoIndex, type AudioLevelId, type VideoLevelId } from './quality';

const WARMUP_MS = 10_000;

export interface AdaptiveDecision {
  video: VideoLevelId;
  audio: AudioLevelId;
  /** True when the link is too weak for any video; audio gets everything. */
  videoPaused: boolean;
}

/**
 * Sender-side quality controller used when the viewer chose "Auto".
 *
 * Inputs come from our outbound stats: the congestion controller's bandwidth
 * estimate, RTCP loss reported by the peer, RTT and the encoder's
 * quality-limitation reason. Downgrades are fast (one bad sample); upgrades
 * need a sustained healthy window and back off exponentially if they bounce,
 * which keeps calls smooth instead of oscillating.
 */
export class AdaptiveController {
  private video: number;
  private audio: number;
  private paused = false;
  private goodStreak = 0;
  private cpuStreak = 0;
  private starveStreak = 0;
  private lastDowngrade = 0;
  private upgradeBackoffMs = 6_000;
  private lastUpgrade = 0;
  private startedAt: number | null = null;
  private pausedAt = 0;
  private probeAfterMs = 15_000;

  constructor(
    start: VideoLevelId,
    startAudio: AudioLevelId,
    private maxVideo: VideoLevelId,
  ) {
    this.video = Math.min(videoIndex(start), videoIndex(maxVideo));
    this.audio = AUDIO_LEVELS.findIndex((l) => l.id === startAudio);
  }

  setMaxVideo(max: VideoLevelId): void {
    this.maxVideo = max;
    this.video = Math.min(this.video, videoIndex(max));
  }

  current(): AdaptiveDecision {
    return { video: VIDEO_LEVELS[this.video].id, audio: AUDIO_LEVELS[this.audio].id, videoPaused: this.paused };
  }

  update(s: CallStats, hasVideo: boolean): AdaptiveDecision {
    const now = s.at;
    this.startedAt ??= now;
    // The congestion controller's estimate starts low and ramps up over the
    // first seconds; don't mistake that ramp for a bad network.
    const warmingUp = now - this.startedAt < WARMUP_MS;
    const loss = s.outLoss;
    const rtt = s.rttMs ?? 0;
    // When the browser exposes no BWE, approximate from what we actually send.
    const budget =
      s.availableOutKbps ??
      (s.qualityLimitation === 'bandwidth' ? ((s.outVideo?.kbps ?? 0) + (s.outAudio?.kbps ?? 0)) * 1.1 : null);

    this.updateAudio(loss, budget);
    if (!hasVideo) return this.current();

    const cur = VIDEO_LEVELS[this.video];
    const audioKbps = AUDIO_LEVELS[this.audio].bitrate / 1000;
    const videoBudget = budget !== null ? budget - audioKbps - 20 : null;

    // ── Severe starvation: pause video so audio stays perfect ─────────────
    if (!warmingUp && videoBudget !== null && videoBudget < 70) this.starveStreak++;
    else this.starveStreak = 0;
    if (!this.paused && this.starveStreak >= 3) {
      this.paused = true;
      this.video = 0;
      this.lastDowngrade = now;
      this.pausedAt = now;
      return this.current();
    }
    if (this.paused) {
      // With video off, the bandwidth estimate only covers audio and rarely
      // rises on its own — so also probe periodically with 144p (backing off
      // if the link is still too weak and video gets paused again).
      const roomy = videoBudget !== null && videoBudget > 220 && loss < 0.05;
      const probe = now - this.pausedAt > this.probeAfterMs && loss < 0.05;
      if (roomy || probe) {
        this.paused = false;
        this.goodStreak = 0;
        this.starveStreak = 0;
        this.probeAfterMs = roomy ? 15_000 : Math.min(this.probeAfterMs * 2, 120_000);
        this.startedAt = now; // fresh warm-up: the estimate needs a few seconds to ramp up again
      }
      return this.current();
    }

    // ── Downgrade (fast) ────────────────────────────────────────────────
    this.cpuStreak = s.qualityLimitation === 'cpu' ? this.cpuStreak + 1 : 0;
    const congested = loss > 0.1 || rtt > 600;
    const overBudget = !warmingUp && videoBudget !== null && videoBudget < (cur.bitrate / 1000) * 0.7;
    if ((congested || overBudget || this.cpuStreak >= 3) && this.video > 0) {
      let target = this.video - 1;
      if (overBudget && videoBudget !== null) {
        // Jump straight to the level that fits the measured budget.
        while (target > 0 && VIDEO_LEVELS[target].bitrate / 1000 > videoBudget * 0.9) target--;
      }
      if (now - this.lastUpgrade < 8_000) this.upgradeBackoffMs = Math.min(this.upgradeBackoffMs * 2, 60_000);
      this.video = target;
      this.lastDowngrade = now;
      this.goodStreak = 0;
      this.cpuStreak = 0;
      return this.current();
    }

    // ── Upgrade (slow, with hysteresis) ─────────────────────────────────
    const next = VIDEO_LEVELS[this.video + 1];
    const canGoHigher = next && this.video + 1 <= videoIndex(this.maxVideo);
    const healthy =
      loss < 0.02 &&
      rtt < 300 &&
      s.qualityLimitation !== 'cpu' &&
      (videoBudget === null ? s.qualityLimitation === 'none' : videoBudget > (next?.bitrate ?? Infinity) / 1000 * 1.2);
    this.goodStreak = healthy ? this.goodStreak + 1 : 0;
    // Plenty of headroom (2× the next level) earns a faster climb.
    const roomy = videoBudget !== null && next && videoBudget > (next.bitrate / 1000) * 2;
    const needed = roomy ? 2 : 4;

    if (canGoHigher && this.goodStreak >= needed && now - this.lastDowngrade > this.upgradeBackoffMs) {
      this.video++;
      this.goodStreak = 0;
      this.lastUpgrade = now;
    } else if (now - this.lastDowngrade > 60_000) {
      this.upgradeBackoffMs = 6_000; // stable for a minute: forgive old bounces
    }
    return this.current();
  }

  private updateAudio(loss: number, budget: number | null): void {
    let target = 2;
    if (loss > 0.12 || (budget !== null && budget < 90)) target = 0;
    else if (loss > 0.05 || (budget !== null && budget < 220)) target = 1;
    // Step audio down immediately, but only back up one level at a time.
    this.audio = target < this.audio ? target : Math.min(this.audio + 1, target);
  }
}
