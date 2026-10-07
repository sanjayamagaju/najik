import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { devicesApi } from '@/services/api/endpoints';
import { telemetry } from '@/services/telemetry';
import { useUiStore } from '@/store/uiStore';
import type { PushProvider } from '@/types/protocol';

import { ANDROID_CHANNELS } from './localNotifications';
import { extractPushData, parsePushPayload } from './payloads';
import { decideForegroundPresentation, getPushHandler, routeForPayload } from './presentation';

export { ANDROID_CHANNELS };

const SILENT: Notifications.NotificationBehavior = {
  shouldShowBanner: false,
  shouldShowList: false,
  shouldPlaySound: false,
  shouldSetBadge: false,
};

const SHOW: Notifications.NotificationBehavior = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: true,
  shouldSetBadge: true,
};

let configured = false;

/** Installs the foreground handler. Safe to call more than once. */
export function configureNotifications(): void {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const payload = parsePushPayload(extractPushData(notification.request));
      const ui = useUiStore.getState();
      const decision = decideForegroundPresentation(payload, {
        activeConversationId: ui.activeConversationId,
        appActive: ui.appActive,
      });
      if (payload) getPushHandler(payload)?.onReceive?.(payload);
      if (decision.kind === 'system') return SHOW;
      if (decision.kind === 'toast') {
        ui.showToast({
          id: `push-${notification.request.identifier}`,
          kind: decision.toastKind,
          title: decision.title,
          body: decision.body,
          conversationId: decision.conversationId,
        });
      }
      return SILENT;
    },
  });
}

export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all([
    Notifications.setNotificationChannelAsync(ANDROID_CHANNELS.messages, {
      name: 'Messages',
      description: 'New messages from your chats',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 120, 180],
      lightColor: '#6C47FF',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      showBadge: true,
    }),
    Notifications.setNotificationChannelAsync(ANDROID_CHANNELS.pings, {
      name: 'Pings',
      description: 'When someone pings you',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 90, 60, 90, 60, 220],
      lightColor: '#FF6B4A',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      showBadge: true,
    }),
  ]);
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export async function getPermissionState(): Promise<PermissionState> {
  const status = await Notifications.getPermissionsAsync();
  if (status.granted || status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL)
    return 'granted';
  return status.canAskAgain ? 'undetermined' : 'denied';
}

/** Shows the OS prompt (channels are created first so Android 13+ can show it). */
export async function requestPermission(): Promise<PermissionState> {
  if (!Device.isDevice) return 'denied';
  await ensureAndroidChannels();
  const current = await getPermissionState();
  if (current !== 'undetermined') return current;
  const result = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return result.granted ? 'granted' : 'denied';
}

let registered: { provider: PushProvider; token: string } | null = null;
let tokenSubscription: Notifications.EventSubscription | null = null;

function providerFor(type: string): PushProvider | null {
  if (type === 'android') return 'fcm';
  if (type === 'ios') return 'apns';
  return null;
}

async function upload(provider: PushProvider, token: string): Promise<void> {
  if (registered?.provider === provider && registered.token === token) return;
  await devicesApi.putPushToken(provider, token);
  registered = { provider, token };
  telemetry.breadcrumb('push', 'device token registered', { provider });
}

/**
 * Registers the native FCM/APNs token with the backend (not the Expo push service) when
 * permission is granted, and keeps it updated when the OS rotates it.
 */
export async function registerDeviceToken(): Promise<void> {
  if (!Device.isDevice) return;
  try {
    await ensureAndroidChannels();
    if ((await getPermissionState()) !== 'granted') return;
    const token = await Notifications.getDevicePushTokenAsync();
    const provider = providerFor(token.type);
    if (!provider || typeof token.data !== 'string') return;
    await upload(provider, token.data);
    tokenSubscription?.remove();
    tokenSubscription = Notifications.addPushTokenListener((next) => {
      const nextProvider = providerFor(next.type);
      if (!nextProvider || typeof next.data !== 'string') return;
      upload(nextProvider, next.data).catch((error: unknown) =>
        telemetry.warn('push', 'token refresh upload failed', { error: String(error) }),
      );
    });
  } catch (error) {
    telemetry.warn('push', 'device token registration failed', { error: String(error) });
  }
}

/** Removes the token server-side (must run before /auth/logout while still authorized). */
export async function unregisterDeviceToken(): Promise<void> {
  tokenSubscription?.remove();
  tokenSubscription = null;
  const current = registered;
  registered = null;
  if (!current) return;
  try {
    await devicesApi.deletePushToken(current.provider);
  } catch (error) {
    telemetry.warn('push', 'token unregister failed', { error: String(error) });
  }
}

/** Forget local registration state without calling the server (forced logout). */
export function forgetDeviceToken(): void {
  tokenSubscription?.remove();
  tokenSubscription = null;
  registered = null;
}

/** Removes delivered notifications that belong to a conversation (on opening it). */
export async function clearConversationNotifications(conversationId: string): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => {
          const data = extractPushData(n.request);
          const content = n.request.content as { threadIdentifier?: string | null };
          return (
            data?.conversation_id === conversationId ||
            content.threadIdentifier === conversationId ||
            n.request.identifier === conversationId
          );
        })
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch (error) {
    telemetry.debug('push', 'clear notifications failed', { error: String(error) });
  }
}

export async function clearAllNotifications(): Promise<void> {
  try {
    await Notifications.dismissAllNotificationsAsync();
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // best-effort
  }
}

export async function setAppBadge(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {
    // unsupported launcher
  }
}

/** Route for a tapped notification, or null. */
export function routeForResponse(response: Notifications.NotificationResponse): string | null {
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  return routeForPayload(parsePushPayload(extractPushData(response.notification.request)));
}
