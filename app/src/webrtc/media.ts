import type { CallMedia } from '../types';

export const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 48_000,
};

export function videoConstraints(facingMode: 'user' | 'environment', shortSide = 720, exact = false): MediaTrackConstraints {
  return {
    facingMode: exact ? { exact: facingMode } : facingMode,
    width: { ideal: Math.round((shortSide * 16) / 9) },
    height: { ideal: shortSide },
    frameRate: { ideal: 30, max: 30 },
  };
}

export class MediaError extends Error {}

function friendly(err: unknown, media: CallMedia): MediaError {
  const name = (err as DOMException)?.name;
  const what = media === 'video' ? 'camera and microphone' : 'microphone';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new MediaError(`Najik needs access to your ${what}. Allow it in your device settings.`);
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new MediaError(`No ${what} found on this device.`);
  }
  if (name === 'NotReadableError') {
    return new MediaError(`Your ${what} is being used by another app.`);
  }
  return new MediaError(`Couldn't start your ${what}.`);
}

/**
 * Acquire local media. For video calls a failing camera degrades gracefully to
 * an audio-only stream instead of aborting the call.
 */
export async function getLocalMedia(media: CallMedia): Promise<{ stream: MediaStream; videoFailed: boolean }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MediaError('Calls need a secure connection (HTTPS) and a modern WebView/browser.');
  }
  if (media === 'video') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: videoConstraints('user'),
      });
      tune(stream);
      return { stream, videoFailed: false };
    } catch (err) {
      if ((err as DOMException)?.name === 'NotAllowedError') throw friendly(err, media);
      // Fall through to audio-only.
    }
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
    tune(stream);
    return { stream, videoFailed: media === 'video' };
  } catch (err) {
    throw friendly(err, 'audio');
  }
}

function tune(stream: MediaStream): void {
  for (const t of stream.getAudioTracks()) t.contentHint = 'speech';
  for (const t of stream.getVideoTracks()) t.contentHint = 'motion';
}

/** Short side of the current capture (resolution class, orientation-agnostic). */
export function captureShortSide(track: MediaStreamTrack): number {
  const s = track.getSettings();
  if (!s.width || !s.height) return 720;
  return Math.min(s.width, s.height);
}

/** Highest short side the camera supports, if the platform reports it. */
export function maxCaptureShortSide(track: MediaStreamTrack): number {
  const caps = track.getCapabilities?.();
  const w = caps?.width?.max;
  const h = caps?.height?.max;
  if (!w || !h) return 1080;
  return Math.min(w, h, 1080);
}

export async function countCameras(): Promise<number> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput').length;
  } catch {
    return 0;
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}
