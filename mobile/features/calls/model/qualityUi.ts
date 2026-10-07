import {
  AUDIO_PRESET_LABEL,
  tierForHeight,
  type VideoTier,
  videoRank,
} from '@/services/webrtc/quality/ladder';
import type { NormalizedStats } from '@/services/webrtc/stats/normalizeStats';
import type { AudioQualityPref, VideoQualityPref } from '@/types/protocol';

/** Pure presentation helpers for the YouTube-style quality sheet. */

/** The ladder tier of the video we are actually receiving (null when no video flows). */
export function receivedVideoTier(stats: NormalizedStats | null): VideoTier | null {
  const v = stats?.inboundVideo;
  if (!v?.width || !v.height) return null;
  return tierForHeight(Math.min(v.width, v.height));
}

/** "Auto (720p)" for Auto, the tier itself otherwise. */
export function videoOptionLabel(pref: VideoQualityPref, received: VideoTier | null): string {
  if (pref !== 'auto') return pref;
  return received ? `Auto (${received})` : 'Auto';
}

export function audioOptionLabel(pref: AudioQualityPref): string {
  return AUDIO_PRESET_LABEL[pref];
}

/**
 * A manual pick is being undercut because of the network (the peer's sender protects its
 * uplink), so the UI shows "Auto-limited".
 */
export function isReceiveAutoLimited(
  pref: VideoQualityPref,
  received: VideoTier | null,
  remoteVideoEnabled: boolean,
): boolean {
  if (pref === 'auto' || !received || !remoteVideoEnabled) return false;
  return videoRank(received) < videoRank(pref);
}

export const VIDEO_PREF_HINT: Record<VideoQualityPref, string> = {
  auto: 'Adjusts to both connections',
  '1080p': 'Full HD',
  '720p': 'HD',
  '480p': '',
  '360p': '',
  '240p': 'Saves data',
  '144p': 'Lowest data',
};

export const AUDIO_PREF_HINT: Record<AudioQualityPref, string> = {
  auto: 'Adjusts to the connection',
  high: '64 kbps',
  medium: '32 kbps',
  low: '16 kbps · saves data',
};

export function formatCallDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}
