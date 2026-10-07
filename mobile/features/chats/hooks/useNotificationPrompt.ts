import { useEffect } from 'react';

import { registerDeviceToken, requestPermission } from '@/services/notifications';
import { telemetry } from '@/services/telemetry';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Asks for notification permission once, at a sensible moment: after the user has landed on
 * a loaded chat list (so the value is obvious), never on the very first frame after sign-up.
 */
export function useNotificationPrompt(ready: boolean): void {
  const prompted = useSettingsStore((s) => s.notificationsPrompted);
  useEffect(() => {
    if (!ready || prompted) return;
    const timer = setTimeout(() => {
      useSettingsStore.getState().setNotificationsPrompted();
      requestPermission()
        .then((state) => (state === 'granted' ? registerDeviceToken() : undefined))
        .catch((error: unknown) =>
          telemetry.warn('push', 'permission prompt failed', { error: String(error) }),
        );
    }, 1500);
    return () => clearTimeout(timer);
  }, [ready, prompted]);
}
