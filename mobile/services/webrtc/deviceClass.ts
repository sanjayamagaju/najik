import * as Device from 'expo-device';

import type { VideoTier } from './quality/ladder';

/**
 * Device-class heuristic for the send-side video cap. Encoding 720p/1080p in real time on an
 * old or low-RAM phone overheats it and starves the UI thread, so those devices stay ≤ 480p.
 */

export type DeviceClass = 'low' | 'mid' | 'high';

const GB = 1024 ** 3;

export function classifyDevice(info: {
  totalMemory: number | null;
  yearClass: number | null;
}): DeviceClass {
  const { totalMemory, yearClass } = info;
  if ((totalMemory !== null && totalMemory < 3 * GB) || (yearClass !== null && yearClass < 2018)) {
    return 'low';
  }
  if ((totalMemory !== null && totalMemory < 6 * GB) || (yearClass !== null && yearClass < 2021)) {
    return 'mid';
  }
  return 'high';
}

export const DEVICE_CLASS_CAP: Record<DeviceClass, VideoTier> = {
  low: '480p',
  mid: '720p',
  high: '1080p',
};

export function currentDeviceClass(): DeviceClass {
  return classifyDevice({ totalMemory: Device.totalMemory, yearClass: Device.deviceYearClass });
}

export function deviceVideoCap(): VideoTier {
  return DEVICE_CLASS_CAP[currentDeviceClass()];
}
