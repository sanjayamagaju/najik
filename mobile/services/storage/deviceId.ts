import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import { secureTokenStore } from './secureTokenStore';

/**
 * Stable per-install device id (PROTOCOL §3 `device.device_id`).
 *
 * Stored in AsyncStorage (wiped on uninstall) rather than the Keychain (which survives
 * reinstalls on iOS). A missing id therefore means a fresh install, so we also wipe any
 * Keychain tokens left behind by a previous installation.
 */
const DEVICE_ID_KEY = 'najik.install.device_id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let cached: string | null = null;
let pending: Promise<string> | null = null;

async function loadOrCreate(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing && UUID_RE.test(existing)) return existing;
  await secureTokenStore.clear();
  const id = Crypto.randomUUID();
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  pending ??= loadOrCreate().finally(() => {
    pending = null;
  });
  cached = await pending;
  return cached;
}
