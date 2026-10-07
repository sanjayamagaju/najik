import { Stack } from 'expo-router';

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { useTheme } from '@/hooks/useTheme';

export { RouteErrorBoundary as ErrorBoundary };

export default function AuthLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
