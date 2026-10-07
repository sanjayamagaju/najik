import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/useTheme';
import { telemetry } from '@/services/telemetry';

import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

/**
 * Per-route error boundary (exported as `ErrorBoundary` from route files). Reports the crash
 * and offers recovery without restarting the app.
 */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { colors, spacing } = useTheme();
  useEffect(() => {
    telemetry.captureException(error, { boundary: 'route' });
  }, [error]);
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.body, { gap: spacing.lg, padding: spacing.xxl }]}>
        <Icon name="cloud-offline-outline" size={48} color="textTertiary" />
        <Text variant="title" align="center" accessibilityRole="header">
          Something went wrong
        </Text>
        <Text variant="callout" color="textSecondary" align="center">
          This screen hit an unexpected problem. Your messages are safe.
        </Text>
        <Button title="Try again" icon="refresh" onPress={() => void retry()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
