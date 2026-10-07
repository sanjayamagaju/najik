import { Stack } from 'expo-router';

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { IncomingCallOverlay } from '@/features/calls/components/IncomingCallOverlay';
import { PingOverlay } from '@/features/ping/components/PingOverlay';
import { useTheme } from '@/hooks/useTheme';
import { useNotificationRouting } from '@/navigation/useNotificationRouting';

export { RouteErrorBoundary as ErrorBoundary };

/** Deep links into a chat keep the tabs underneath so "back" lands on the chat list. */
export const unstable_settings = { anchor: '(tabs)' };

export default function AppLayout() {
  const { colors, typography } = useTheme();
  useNotificationRouting();
  return (
    <>
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.primary,
          headerTitleStyle: { fontFamily: typography.headline.fontFamily, color: colors.text },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="chat/[id]"
          options={{ headerShown: false, animation: 'slide_from_right' }}
        />
        <Stack.Screen name="new-chat" options={{ title: 'New chat', presentation: 'modal' }} />
        <Stack.Screen name="account/profile" options={{ title: 'Edit profile' }} />
        <Stack.Screen name="account/sessions" options={{ title: 'Devices & sessions' }} />
        <Stack.Screen name="account/password" options={{ title: 'Change password' }} />
        <Stack.Screen name="account/delete" options={{ title: 'Delete account' }} />
        <Stack.Screen
          name="call/[peerId]"
          options={{
            headerShown: false,
            presentation: 'fullScreenModal',
            animation: 'fade_from_bottom',
            gestureEnabled: false,
            contentStyle: { backgroundColor: '#000000' },
          }}
        />
      </Stack>
      <PingOverlay />
      <IncomingCallOverlay />
    </>
  );
}
