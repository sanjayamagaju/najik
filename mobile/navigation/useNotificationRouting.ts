import * as Notifications from 'expo-notifications';
import { type Href, router } from 'expo-router';
import { useEffect } from 'react';

import { routeForResponse } from '@/services/notifications';
import { telemetry } from '@/services/telemetry';

const handled = new Set<string>();

function handle(response: Notifications.NotificationResponse): void {
  const id = response.notification.request.identifier;
  if (handled.has(id)) return;
  handled.add(id);
  const route = routeForResponse(response);
  telemetry.breadcrumb('push', 'notification opened', { routed: route !== null });
  if (route) router.push(route as Href);
  Notifications.clearLastNotificationResponse();
}

/**
 * Tap on a notification → open the right screen. Handles both cold starts (the response that
 * launched the app) and taps while running. Mounted inside the signed-in layout so navigation
 * only happens once the session is restored.
 */
export function useNotificationRouting(): void {
  useEffect(() => {
    const last = Notifications.getLastNotificationResponse();
    if (last) handle(last);
    const subscription = Notifications.addNotificationResponseReceivedListener(handle);
    return () => subscription.remove();
  }, []);
}
