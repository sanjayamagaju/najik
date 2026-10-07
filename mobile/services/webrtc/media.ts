import { PermissionsAndroid, Platform } from 'react-native';
import { mediaDevices } from 'react-native-webrtc';

import type { CallMedia } from '@/types/protocol';

import { type VideoTier, videoSpec } from './quality/ladder';
import type { MediaStreamLike, MediaTrackLike } from './types';

/** Local capture: permissions, getUserMedia with sane constraints, camera switching. */

export type MediaErrorCode = 'permission_denied' | 'no_device' | 'unknown';

export class MediaAcquireError extends Error {
  readonly code: MediaErrorCode;
  constructor(code: MediaErrorCode, message: string) {
    super(message);
    this.name = 'MediaAcquireError';
    this.code = code;
  }
}

export type CameraFacing = 'user' | 'environment';

/**
 * Android needs runtime grants before getUserMedia; iOS prompts from getUserMedia itself (the
 * usage strings live in app.config.ts). Returns false when the user refused.
 */
export async function ensureMediaPermissions(media: CallMedia): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (media === 'video') wanted.push(PermissionsAndroid.PERMISSIONS.CAMERA);
  // BLUETOOTH_CONNECT lets audio route to a headset on Android 12+; refusing it is not fatal.
  const btConnect = (PermissionsAndroid.PERMISSIONS as Record<string, string | undefined>)
    .BLUETOOTH_CONNECT;
  const all =
    btConnect && Number(Platform.Version) >= 31
      ? [...wanted, btConnect as (typeof wanted)[number]]
      : wanted;
  const result = await PermissionsAndroid.requestMultiple(all);
  return wanted.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

export function captureConstraints(media: CallMedia, facing: CameraFacing, maxTier: VideoTier) {
  // Capture at ≤ 720p unless the device may send 1080p; the encoder scales down from here.
  const spec = videoSpec(maxTier === '1080p' ? '1080p' : maxTier === '720p' ? '720p' : '480p');
  return {
    // AEC / noise suppression / AGC are on by default in react-native-webrtc's audio module.
    audio: true,
    video:
      media === 'video'
        ? {
            facingMode: facing,
            width: { ideal: spec.width },
            height: { ideal: spec.height },
            frameRate: { ideal: 30, max: 30 },
          }
        : false,
  };
}

export async function acquireLocalMedia(
  media: CallMedia,
  options: { facing?: CameraFacing; maxTier: VideoTier },
): Promise<MediaStreamLike> {
  try {
    const stream = await mediaDevices.getUserMedia(
      captureConstraints(media, options.facing ?? 'user', options.maxTier),
    );
    return stream as unknown as MediaStreamLike;
  } catch (error) {
    const name = (error as { name?: string } | null)?.name ?? '';
    const message = error instanceof Error ? error.message : String(error);
    if (name === 'NotAllowedError' || name === 'SecurityError' || /permission/i.test(message)) {
      throw new MediaAcquireError('permission_denied', message);
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new MediaAcquireError('no_device', message);
    }
    throw new MediaAcquireError('unknown', message);
  }
}

/** Short edge of the capture (portrait phones report 720×1280 for a 720p capture). */
export function captureHeightOf(track: MediaTrackLike | undefined | null): number | null {
  const settings = track?.getSettings?.();
  if (!settings?.width || !settings.height) return null;
  return Math.min(settings.width, settings.height);
}

export async function switchCamera(
  track: MediaTrackLike,
  current: CameraFacing,
): Promise<CameraFacing> {
  const next: CameraFacing = current === 'user' ? 'environment' : 'user';
  if (track.applyConstraints) {
    const settings = track.getSettings?.() ?? {};
    await track.applyConstraints({
      ...(settings.width ? { width: settings.width } : {}),
      ...(settings.height ? { height: settings.height } : {}),
      ...(settings.frameRate ? { frameRate: settings.frameRate } : {}),
      facingMode: next,
    });
  }
  return next;
}

export function stopStream(stream: MediaStreamLike | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // already stopped
    }
  }
  try {
    stream.release?.(false);
  } catch {
    // ignore
  }
}
