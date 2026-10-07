import * as Haptics from 'expo-haptics';

import { useSettingsStore } from '@/store/settingsStore';

function run(fn: () => Promise<void>): void {
  if (!useSettingsStore.getState().haptics) return;
  fn().catch(() => {
    // Haptics are best-effort (unsupported hardware, low-power mode).
  });
}

/** Haptics facade honouring the user's "Haptics" setting. */
export const haptics = {
  selection: () => run(() => Haptics.selectionAsync()),
  light: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  heavy: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
