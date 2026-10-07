import * as SystemUI from 'expo-system-ui';
import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { buildTheme, type ColorScheme, type Theme } from '@/constants/theme';
import { useSettingsStore } from '@/store/settingsStore';

const ThemeContext = createContext<Theme>(buildTheme('light'));

export function useResolvedScheme(): ColorScheme {
  const system = useColorScheme();
  const preference = useSettingsStore((s) => s.theme);
  if (preference === 'light' || preference === 'dark') return preference;
  return system === 'dark' ? 'dark' : 'light';
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useResolvedScheme();
  const theme = useMemo(() => buildTheme(scheme), [scheme]);

  useEffect(() => {
    // Root view background (visible behind transitions / keyboard) follows the theme.
    SystemUI.setBackgroundColorAsync(theme.colors.background).catch(() => undefined);
  }, [theme.colors.background]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
