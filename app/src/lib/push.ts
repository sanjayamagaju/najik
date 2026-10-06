import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNative, getServerUrl } from './config';
import { api, tokenStore } from './api';
import { useToasts } from '../stores/toast';

export interface CallAction {
  action: 'accept' | 'open';
  callId: string;
}

/** Native plugin implemented in android/app/src/main/java/com/najik/app/NajikPushPlugin.java */
interface NajikPushPlugin {
  getToken(): Promise<{ token: string }>;
  requestPermission(): Promise<{ granted: boolean }>;
  setSession(options: { serverUrl: string; token: string }): Promise<void>;
  clearSession(): Promise<void>;
  fullScreenStatus(): Promise<{ allowed: boolean }>;
  openFullScreenSettings(): Promise<void>;
  releaseLockScreen(): Promise<void>;
  addListener(event: 'callAction', fn: (action: CallAction) => void): Promise<PluginListenerHandle>;
}

const NajikPush = registerPlugin<NajikPushPlugin>('NajikPush');

const FCM_KEY = 'najik.fcmToken';
const FULLSCREEN_PROMPTED_KEY = 'najik.fullScreenPrompted';

/**
 * Called after sign-in. Registers this device for incoming-call pushes and
 * hands the session to the native layer so "Decline" works from the
 * notification while the app is closed.
 */
export async function enablePush(): Promise<void> {
  if (!isNative) return;
  const session = tokenStore.get();
  if (!session) return;
  await NajikPush.setSession({ serverUrl: getServerUrl(), token: session }).catch(() => {});

  const { granted } = await NajikPush.requestPermission().catch(() => ({ granted: false }));
  if (!granted) {
    useToasts.getState().push(
      {
        tone: 'info',
        title: 'Notifications are off',
        description: "You won't hear incoming calls while Najik is closed.",
      },
      6000,
    );
    return;
  }

  try {
    const { token } = await NajikPush.getToken();
    await api('/push/register', { body: { token, platform: 'android' } });
    localStorage.setItem(FCM_KEY, token);
  } catch (err) {
    // Typically: google-services.json not bundled. Calls still work while the app is open.
    console.info('[najik] push unavailable:', (err as Error).message);
    return;
  }

  // Android 14+: full-screen call alerts need an explicit user grant.
  const { allowed } = await NajikPush.fullScreenStatus().catch(() => ({ allowed: true }));
  if (!allowed && !localStorage.getItem(FULLSCREEN_PROMPTED_KEY)) {
    localStorage.setItem(FULLSCREEN_PROMPTED_KEY, '1');
    useToasts.getState().push(
      {
        tone: 'info',
        title: 'Show calls on the lock screen',
        description: 'Tap to allow full-screen incoming calls.',
        onClick: () => void NajikPush.openFullScreenSettings(),
      },
      9000,
    );
  }
}

/** Called before sign-out: this device must stop ringing for the account. */
export async function disablePush(): Promise<void> {
  if (!isNative) return;
  const token = localStorage.getItem(FCM_KEY);
  localStorage.removeItem(FCM_KEY);
  await NajikPush.clearSession().catch(() => {});
  if (token) await api('/push/unregister', { body: { token, platform: 'android' } }).catch(() => {});
}

/** Answer / tap on an incoming-call notification. */
export function onCallAction(fn: (action: CallAction) => void): () => void {
  if (!isNative) return () => {};
  const handle = NajikPush.addListener('callAction', fn);
  return () => void handle.then((h) => h.remove());
}

/** Stop showing the app above the lock screen once a call is over. */
export function releaseLockScreen(): void {
  if (isNative) void NajikPush.releaseLockScreen().catch(() => {});
}
