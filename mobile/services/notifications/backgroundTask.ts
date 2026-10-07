import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import { telemetry } from '@/services/telemetry';

import { parsePushPayload } from './payloads';
import { getPushHandler } from './presentation';

/**
 * Headless/background push handling. Must be defined at module scope before the app renders,
 * so it is imported from the custom entry (`index.ts`).
 *
 * Needed because some pushes are data-only (PROTOCOL §5 + backend notes): the Android **ping**
 * push carries no `notification` block, so the app must present it itself, and the calls feature's
 * `call.incoming` / `call.ended` arrive the same way (via `registerPushHandler(..., { onBackground })`).
 */
export const BACKGROUND_NOTIFICATION_TASK = 'najik-background-notification';

function dataFromTask(payload: Notifications.NotificationTaskPayload): unknown {
  if ('actionIdentifier' in payload) return null; // a notification response, handled by the router hook
  const { dataString, ...rest } = payload.data ?? {};
  if (typeof dataString === 'string') {
    try {
      return JSON.parse(dataString) as unknown;
    } catch {
      return null;
    }
  }
  return rest;
}

TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  BACKGROUND_NOTIFICATION_TASK,
  async ({ data, error }) => {
    if (error || !data) return Notifications.BackgroundNotificationTaskResult.NoData;
    try {
      const payload = parsePushPayload(dataFromTask(data));
      if (!payload) return Notifications.BackgroundNotificationTaskResult.NoData;
      const handler = getPushHandler(payload);
      if (!handler?.onBackground) return Notifications.BackgroundNotificationTaskResult.NoData;
      // In the foreground the WebSocket already delivers the same event (e.g. the ping wave).
      if (AppState.currentState === 'active' && handler.skipBackgroundWhenActive !== false) {
        return Notifications.BackgroundNotificationTaskResult.NoData;
      }
      await handler.onBackground(payload);
      return Notifications.BackgroundNotificationTaskResult.NewData;
    } catch (e) {
      telemetry.warn('push', 'background push handling failed', { error: String(e) });
      return Notifications.BackgroundNotificationTaskResult.Failed;
    }
  },
);

export async function registerBackgroundNotificationTask(): Promise<void> {
  try {
    if (!(await TaskManager.isTaskRegisteredAsync(BACKGROUND_NOTIFICATION_TASK))) {
      await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
    }
  } catch (e) {
    telemetry.warn('push', 'background task registration failed', { error: String(e) });
  }
}
