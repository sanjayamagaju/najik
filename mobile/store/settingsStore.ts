import { create } from 'zustand';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface DeviceSettings {
  theme: ThemePreference;
  haptics: boolean;
  /** Whether we've already shown the OS notification prompt (ask once, at a sensible moment). */
  notificationsPrompted: boolean;
}

interface SettingsState extends DeviceSettings {
  hydrated: boolean;
  hydrate: (settings: Partial<DeviceSettings>) => void;
  setTheme: (theme: ThemePreference) => void;
  setHaptics: (enabled: boolean) => void;
  setNotificationsPrompted: () => void;
}

export const DEFAULT_SETTINGS: DeviceSettings = {
  theme: 'system',
  haptics: true,
  notificationsPrompted: false,
};

export const useSettingsStore = create<SettingsState>()((set) => ({
  ...DEFAULT_SETTINGS,
  hydrated: false,
  hydrate: (settings) => set({ ...DEFAULT_SETTINGS, ...settings, hydrated: true }),
  setTheme: (theme) => set({ theme }),
  setHaptics: (haptics) => set({ haptics }),
  setNotificationsPrompted: () => set({ notificationsPrompted: true }),
}));

export function parseSettings(data: unknown): Partial<DeviceSettings> | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const out: Partial<DeviceSettings> = {};
  if (d.theme === 'system' || d.theme === 'light' || d.theme === 'dark') out.theme = d.theme;
  if (typeof d.haptics === 'boolean') out.haptics = d.haptics;
  if (typeof d.notificationsPrompted === 'boolean')
    out.notificationsPrompted = d.notificationsPrompted;
  return out;
}
