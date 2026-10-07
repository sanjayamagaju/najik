import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/useTheme';

import { CALL_SURFACE } from './callSurface';

/** Shown while ICE is restarting; the call controls stay usable underneath. */
export function ReconnectingOverlay() {
  const { spacing, radii } = useTheme();
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.root]}
      accessibilityLiveRegion="polite"
    >
      <View
        style={[
          styles.card,
          {
            gap: spacing.sm,
            paddingHorizontal: spacing.xl,
            paddingVertical: spacing.lg,
            borderRadius: radii.lg,
          },
        ]}
      >
        <ActivityIndicator color="#FFFFFF" />
        <Text variant="headline" tint={CALL_SURFACE.text} accessibilityRole="alert">
          Reconnecting…
        </Text>
        <Text variant="footnote" tint={CALL_SURFACE.textSecondary} align="center">
          Hold on, the connection dropped.
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', backgroundColor: CALL_SURFACE.scrim },
  card: { alignItems: 'center', backgroundColor: CALL_SURFACE.chip },
});
