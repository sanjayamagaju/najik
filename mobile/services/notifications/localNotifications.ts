import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** Must match the backend's FCM channel ids (PROTOCOL §5 / backend notes). */
export const ANDROID_CHANNELS = {
  messages: 'messages',
  pings: 'pings',
  /** Created by `features/calls/push.ts` (natively with ringtone audio attributes). */
  calls: 'calls',
} as const;

/**
 * Presents a data-only Android ping push. The content mirrors what the server would have put in
 * a `notification` block; `data` keeps the contract shape so tapping routes to the chat.
 */
export async function presentPingNotification(
  conversationId: string,
  senderName: string,
): Promise<void> {
  if (Platform.OS !== 'android') return; // iOS ping pushes carry an APNs alert already
  await Notifications.scheduleNotificationAsync({
    content: {
      title: senderName ? `${senderName} pinged you` : 'New Ping',
      body: 'Tap to open the chat',
      data: { type: 'ping', conversation_id: conversationId, sender_name: senderName },
      sound: 'default',
    },
    trigger: { channelId: ANDROID_CHANNELS.pings },
  });
}
