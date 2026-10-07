import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type Theme as NavTheme } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { ToastHost } from '@/components/ToastHost';
import { configResult } from '@/config/env';
import { bootstrapSession } from '@/features/auth/services/authService';
import { installCallHandlers } from '@/features/calls/services/callService';
import { AppThemeProvider, useTheme } from '@/hooks/useTheme';
import { ConfigErrorScreen } from '@/screens/ConfigErrorScreen';
import {
  configureNotifications,
  registerBackgroundNotificationTask,
} from '@/services/notifications';
import { installRealtimeHandlers } from '@/services/realtime/realtime';
import { initMonitoring, telemetry, wrapRoot } from '@/services/telemetry';
import { useAuthStore } from '@/store/authStore';
import { hydrateDeviceSettings, startSettingsPersistence } from '@/store/persistence';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

if (configResult.ok) {
  initMonitoring(configResult.config);
  configureNotifications();
  void registerBackgroundNotificationTask();
  installRealtimeHandlers();
  installCallHandlers();
}

export { RouteErrorBoundary as ErrorBoundary };

function RootNavigator() {
  const status = useAuthStore((s) => s.status);
  const theme = useTheme();
  const navTheme = useMemo<NavTheme>(() => {
    const base = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.colors.primary,
        background: theme.colors.background,
        card: theme.colors.background,
        text: theme.colors.text,
        border: theme.colors.separator,
        notification: theme.colors.accent,
      },
    };
  }, [theme]);

  const signedIn = status === 'signedIn';
  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
          animation: 'fade',
        }}
      >
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Screen name="+not-found" />
      </Stack>
      <ToastHost />
    </ThemeProvider>
  );
}

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [booted, setBooted] = useState(!configResult.ok);

  useEffect(() => {
    if (!configResult.ok) return;
    let cancelled = false;
    (async () => {
      await hydrateDeviceSettings();
      startSettingsPersistence();
      await bootstrapSession();
    })()
      .catch((error: unknown) => {
        telemetry.error('boot', 'startup failed', error);
        useAuthStore.getState().setSignedOut(null);
      })
      .finally(() => {
        if (!cancelled) setBooted(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = (fontsLoaded || fontError !== null) && booted;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AppThemeProvider>
          <ReducedMotionConfig mode={ReduceMotion.System} />
          {configResult.ok ? <RootNavigator /> : <ConfigErrorScreen errors={configResult.errors} />}
        </AppThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });

export default wrapRoot(RootLayout);
