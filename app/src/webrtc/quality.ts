export type VideoLevelId = '144p' | '240p' | '360p' | '480p' | '720p' | '1080p';
export type AudioLevelId = 'low' | 'medium' | 'high';
export type VideoPref = 'auto' | VideoLevelId;
export type AudioPref = 'auto' | AudioLevelId;

export interface VideoLevel {
  id: VideoLevelId;
  /** Short side of the frame in px (resolution class). */
  height: number;
  width: number;
  fps: number;
  /** Encoder ceiling in bits per second. */
  bitrate: number;
}

export interface AudioLevel {
  id: AudioLevelId;
  label: string;
  hint: string;
  bitrate: number;
}

/** Ordered low → high. Bitrates tuned for VP8/H.264 talking-head content. */
export const VIDEO_LEVELS: VideoLevel[] = [
  { id: '144p', height: 144, width: 256, fps: 15, bitrate: 120_000 },
  { id: '240p', height: 240, width: 426, fps: 20, bitrate: 260_000 },
  { id: '360p', height: 360, width: 640, fps: 30, bitrate: 550_000 },
  { id: '480p', height: 480, width: 854, fps: 30, bitrate: 950_000 },
  { id: '720p', height: 720, width: 1280, fps: 30, bitrate: 1_800_000 },
  { id: '1080p', height: 1080, width: 1920, fps: 30, bitrate: 3_500_000 },
];

/** Opus bitrates. Even "low" stays intelligible thanks to in-band FEC. */
export const AUDIO_LEVELS: AudioLevel[] = [
  { id: 'low', label: 'Low', hint: 'Data saver · 16 kbps', bitrate: 16_000 },
  { id: 'medium', label: 'Medium', hint: 'Clear voice · 32 kbps', bitrate: 32_000 },
  { id: 'high', label: 'High', hint: 'Studio voice · 64 kbps', bitrate: 64_000 },
];

export const videoLevel = (id: VideoLevelId): VideoLevel => VIDEO_LEVELS.find((l) => l.id === id)!;
export const videoIndex = (id: VideoLevelId): number => VIDEO_LEVELS.findIndex((l) => l.id === id);
export const audioLevel = (id: AudioLevelId): AudioLevel => AUDIO_LEVELS.find((l) => l.id === id)!;
export const audioIndex = (id: AudioLevelId): number => AUDIO_LEVELS.findIndex((l) => l.id === id);

/** Highest video level the given capture short-side can produce. */
export function maxLevelForCapture(shortSide: number): VideoLevelId {
  let best: VideoLevelId = '144p';
  for (const l of VIDEO_LEVELS) if (l.height <= shortSide + 8) best = l.id;
  return best;
}

interface NetworkInformationLike {
  effectiveType?: string;
  downlink?: number;
  saveData?: boolean;
}

/** A sensible first guess before real congestion feedback arrives. */
export function initialVideoLevel(maxId: VideoLevelId): VideoLevelId {
  const conn = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  let guess: VideoLevelId = '480p';
  if (conn?.saveData) guess = '240p';
  else if (conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g') guess = '144p';
  else if (conn?.effectiveType === '3g') guess = '240p';
  else if (conn?.downlink !== undefined && conn.downlink < 1.5) guess = '360p';
  return videoIndex(guess) <= videoIndex(maxId) ? guess : maxId;
}

export function initialAudioLevel(): AudioLevelId {
  const conn = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  if (conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g') return 'low';
  return 'high';
}
