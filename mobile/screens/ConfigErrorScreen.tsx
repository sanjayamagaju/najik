import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/useTheme';

/**
 * Shown instead of the app when the runtime config is invalid (e.g. a staging/production
 * build pointing at http:// or ws://). The app refuses to talk to any backend in this state.
 */
export function ConfigErrorScreen({ errors }: { errors: string[] }) {
  const { colors, spacing, radii } = useTheme();
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.body, { padding: spacing.xxl, gap: spacing.lg }]}>
        <Icon name="shield-outline" size={48} color="danger" />
        <Text variant="title" align="center" accessibilityRole="header">
          Najik can’t start
        </Text>
        <Text variant="callout" color="textSecondary" align="center">
          This build is misconfigured, so it won’t connect to any server. Please install an official
          version of the app.
        </Text>
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radii.md,
            padding: spacing.md,
            gap: spacing.xs,
            alignSelf: 'stretch',
          }}
        >
          {errors.map((e) => (
            <Text key={e} variant="footnote" color="danger">
              • {e}
            </Text>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
