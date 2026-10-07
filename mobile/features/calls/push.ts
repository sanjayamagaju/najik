import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import type { IncomingCallPayload } from '@/modules/najik-calls';
import { registerPushHandler } from '@/services/notifications/presentation';
import { ANDROID_CHANNELS } from '@/services/notifications/localNotifications';
import { telemetry } from '@/services/telemetry';

import { createCallNativeBridge } from './native/callNative';

/**
 * `call.incoming` / `call.ended` push handling (PROTOCOL §5). Imported from the custom entry
 * (`index.ts`) so it is registered in headless JS too, where the data-only FCM push wakes the
 * background notification task with no UI mounted.
 *
 *  - App killed/backgrounded (Android): post the full-screen incoming-call notification.
 *  - App in the foreground: hand the payload to the CallController (deduped with the WS event).
 *  - iOS: VoIP pushes never reach JS this way — PushKit + CallKit handle them natively.
 */

const native = createCallNativeBridge();

type ForegroundSink = {
  incoming: (payload: IncomingCallPayload) => void;
  ended: (callId: string, reason: string) => void;
};

let sink: ForegroundSink | null = null;

/** Set by the CallController wiring once the app UI is up. */
export function setCallPushSink(next: ForegroundSink | null): void {
  sink = next;
}

/** Creates the `calls` channel: natively (ringtone audio attributes) or via expo as a fallback. */
export async function ensureCallChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (native.available) {
    native.ensureChannel();
    return;
  }
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNELS.calls, {
      name: 'Calls',
      description: 'Incoming voice and video calls',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 900, 700, 900, 700],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      sound: 'default',
    });
  } catch (error) {
    telemetry.warn('calls', 'calls channel creation failed', { error: String(error) });
  }
}

function appActive(): boolean {
  return AppState.currentState === 'active';
}

registerPushHandler('call.incoming', {
  // The WebSocket (or this push via onReceive) drives the in-app incoming UI instead.
  foreground: () => ({ kind: 'suppress' }),
  onReceive: (p) => sink?.incoming(p),
  // iOS alert fallback (no VoIP token): opening it shows the incoming call screen.
  routeOnTap: (p) =>
    `/call/${p.caller_id}?media=${p.media}&callId=${p.call_id}&callerName=${encodeURIComponent(p.caller_name)}`,
  onBackground: async (p) => {
    if (appActive() && sink) {
      sink.incoming(p);
      return;
    }
    await ensureCallChannel();
    native.showIncoming(p);
    telemetry.breadcrumb('call', 'incoming call notification posted');
  },
  skipBackgroundWhenActive: false,
});

registerPushHandler('call.ended', {
  foreground: () => ({ kind: 'suppress' }),
  onReceive: (p) => sink?.ended(p.call_id, p.reason),
  onBackground: (p) => {
    native.dismissIncoming(p.call_id);
    if (sink) sink.ended(p.call_id, p.reason);
    else native.reportEnded(p.call_id, p.reason);
  },
  skipBackgroundWhenActive: false,
});
