import type { AudioQualityPref, VideoQualityPref } from '@/types/protocol';

/**
 * Send-side quality presets (docs/ARCHITECTURE.md "Adaptive quality"). Pure data + helpers so
 * the controller, UI and tests share one ladder.
 */

export type VideoTier = Exclude<VideoQualityPref, 'auto'>;
export type AudioPreset = Exclude<AudioQualityPref, 'auto'>;

export interface VideoTierSpec {
  tier: VideoTier;
  width: number;
  height: number;
  fps: number;
  /** bits per second */
  maxBitrate: number;
}

/** Highest first. */
export const VIDEO_LADDER: readonly VideoTierSpec[] = [
  { tier: '1080p', width: 1920, height: 1080, fps: 30, maxBitrate: 3_500_000 },
  { tier: '720p', width: 1280, height: 720, fps: 30, maxBitrate: 1_800_000 },
  { tier: '480p', width: 854, height: 480, fps: 30, maxBitrate: 900_000 },
  { tier: '360p', width: 640, height: 360, fps: 24, maxBitrate: 550_000 },
  { tier: '240p', width: 426, height: 240, fps: 20, maxBitrate: 300_000 },
  { tier: '144p', width: 256, height: 144, fps: 15, maxBitrate: 150_000 },
] as const;

export const VIDEO_TIERS: readonly VideoTier[] = VIDEO_LADDER.map((s) => s.tier);

export interface AudioPresetSpec {
  preset: AudioPreset;
  /** bits per second */
  maxBitrate: number;
  fec: boolean;
  dtx: boolean;
  stereo: false;
}

/** Highest first. */
export const AUDIO_PRESETS: readonly AudioPresetSpec[] = [
  { preset: 'high', maxBitrate: 64_000, fec: true, dtx: false, stereo: false },
  { preset: 'medium', maxBitrate: 32_000, fec: true, dtx: false, stereo: false },
  { preset: 'low', maxBitrate: 16_000, fec: true, dtx: true, stereo: false },
] as const;

export const AUDIO_PRESET_ORDER: readonly AudioPreset[] = AUDIO_PRESETS.map((p) => p.preset);

/** Larger rank = better quality. */
export function videoRank(tier: VideoTier): number {
  return VIDEO_TIERS.length - 1 - VIDEO_TIERS.indexOf(tier);
}

export function audioRank(preset: AudioPreset): number {
  return AUDIO_PRESET_ORDER.length - 1 - AUDIO_PRESET_ORDER.indexOf(preset);
}

export function videoSpec(tier: VideoTier): VideoTierSpec {
  return VIDEO_LADDER.find((s) => s.tier === tier) ?? VIDEO_LADDER[VIDEO_LADDER.length - 1]!;
}

export function audioSpec(preset: AudioPreset): AudioPresetSpec {
  return AUDIO_PRESETS.find((p) => p.preset === preset) ?? AUDIO_PRESETS[0]!;
}

export function minVideoTier(...tiers: VideoTier[]): VideoTier {
  return tiers.reduce((a, b) => (videoRank(b) < videoRank(a) ? b : a));
}

export function minAudioPreset(...presets: AudioPreset[]): AudioPreset {
  return presets.reduce((a, b) => (audioRank(b) < audioRank(a) ? b : a));
}

/** One step up (better), or null at the top. */
export function nextVideoTierUp(tier: VideoTier): VideoTier | null {
  const i = VIDEO_TIERS.indexOf(tier);
  return i > 0 ? VIDEO_TIERS[i - 1]! : null;
}

/** One step down (worse), or null at the bottom. */
export function nextVideoTierDown(tier: VideoTier): VideoTier | null {
  const i = VIDEO_TIERS.indexOf(tier);
  return i >= 0 && i < VIDEO_TIERS.length - 1 ? VIDEO_TIERS[i + 1]! : null;
}

export function nextAudioUp(preset: AudioPreset): AudioPreset | null {
  const i = AUDIO_PRESET_ORDER.indexOf(preset);
  return i > 0 ? AUDIO_PRESET_ORDER[i - 1]! : null;
}

export function nextAudioDown(preset: AudioPreset): AudioPreset | null {
  const i = AUDIO_PRESET_ORDER.indexOf(preset);
  return i >= 0 && i < AUDIO_PRESET_ORDER.length - 1 ? AUDIO_PRESET_ORDER[i + 1]! : null;
}

/** The ladder tier whose height best describes a frame height (e.g. a 714p frame → 720p). */
export function tierForHeight(height: number | null | undefined): VideoTier | null {
  if (!height || height <= 0) return null;
  // Portrait capture reports the long edge as width; callers pass min(width, height).
  for (const spec of VIDEO_LADDER) {
    if (height >= spec.height * 0.9) return spec.tier;
  }
  return '144p';
}

/** Largest tier whose bitrate fits within `bps` (never below the floor tier). */
export function tierForBitrate(bps: number): VideoTier {
  for (const spec of VIDEO_LADDER) {
    if (spec.maxBitrate <= bps) return spec.tier;
  }
  return '144p';
}

/**
 * `scaleResolutionDownBy` that turns a capture of `captureHeight` into the tier's height.
 * Never upscales (≥ 1) and is rounded to 2 decimals so repeated applies are stable.
 */
export function scaleDownFor(tier: VideoTier, captureHeight: number): number {
  const target = videoSpec(tier).height;
  if (!captureHeight || captureHeight <= target) return 1;
  return Math.round((captureHeight / target) * 100) / 100;
}

export const VIDEO_PREF_OPTIONS: readonly VideoQualityPref[] = ['auto', ...VIDEO_TIERS];
export const AUDIO_PREF_OPTIONS: readonly AudioQualityPref[] = [
  'auto',
  ...AUDIO_PRESET_ORDER,
] as const;

export const AUDIO_PRESET_LABEL: Record<AudioQualityPref, string> = {
  auto: 'Auto',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
