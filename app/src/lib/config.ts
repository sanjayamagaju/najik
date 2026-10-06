import { Capacitor } from '@capacitor/core';

const KEY = 'najik.serverUrl';

export const isNative = Capacitor.isNativePlatform();

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Base URL of the Najik server ('' = same origin, used by the web dev proxy). */
export function getServerUrl(): string {
  const saved = localStorage.getItem(KEY);
  if (saved) return normalize(saved);
  return normalize(import.meta.env.VITE_SERVER_URL ?? '');
}

export function setServerUrl(url: string): void {
  const value = normalize(url);
  if (value) localStorage.setItem(KEY, value);
  else localStorage.removeItem(KEY);
}

/** The native app has no same-origin server, so it needs an explicit URL. */
export function needsServerUrl(): boolean {
  return isNative && !getServerUrl();
}
