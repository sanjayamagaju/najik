import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App } from '@capacitor/app';
import { isNative } from './config';

/** Thin wrappers that no-op gracefully on the web. */
export const haptic = {
  tap() {
    if (isNative) void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    else navigator.vibrate?.(8);
  },
  medium() {
    if (isNative) void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    else navigator.vibrate?.(15);
  },
  success() {
    if (isNative) void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
    else navigator.vibrate?.([10, 40, 10]);
  },
  ping() {
    if (isNative) void Haptics.vibrate({ duration: 220 }).catch(() => {});
    else navigator.vibrate?.([60, 60, 120]);
  },
  ring(on: boolean) {
    if (!('vibrate' in navigator)) return;
    navigator.vibrate(on ? [600, 400, 600, 400, 600, 400, 600, 400, 600, 400, 600, 400, 600, 400, 600] : 0);
  },
};

export async function syncStatusBar(dark: boolean): Promise<void> {
  if (!isNative) return;
  try {
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: dark ? '#0b0b14' : '#f4f3fa' });
  } catch {
    /* plugin unavailable */
  }
}

/** Android hardware back button: run `handler`; if it returns false, minimise the app. */
export function onBackButton(handler: () => boolean): () => void {
  if (!isNative) return () => {};
  const sub = App.addListener('backButton', () => {
    if (!handler()) void App.minimizeApp();
  });
  return () => void sub.then((s) => s.remove());
}

export function onAppResume(handler: () => void): () => void {
  if (!isNative) {
    const fn = () => document.visibilityState === 'visible' && handler();
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  }
  const sub = App.addListener('resume', handler);
  return () => void sub.then((s) => s.remove());
}

/**
 * Keep the screen awake during calls (Screen Wake Lock API). The browser drops
 * the lock whenever the page is hidden, so it is re-acquired on return.
 */
interface WakeLockSentinelLike extends EventTarget {
  release(): Promise<void>;
}
let wantAwake = false;
let wakeLock: WakeLockSentinelLike | null = null;

async function acquireWakeLock(): Promise<void> {
  const api = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock;
  if (!wantAwake || wakeLock || !api || document.visibilityState !== 'visible') return;
  try {
    const lock = await api.request('screen');
    if (!wantAwake) {
      void lock.release().catch(() => {}); // turned off while the request was pending
      return;
    }
    wakeLock = lock;
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
  } catch {
    /* not allowed right now */
  }
}

document.addEventListener('visibilitychange', () => void acquireWakeLock());

export async function keepAwake(on: boolean): Promise<void> {
  wantAwake = on;
  if (on) return acquireWakeLock();
  const lock = wakeLock;
  wakeLock = null;
  await lock?.release().catch(() => {});
}
