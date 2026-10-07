import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/useTheme';

function Dot({ value, color }: { value: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + value.get() * 0.65,
    transform: [{ translateY: -3 * value.get() }],
  }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

/** "…" bubble shown at the bottom of the thread while the peer types. */
export function TypingIndicator() {
  const { colors, radii, spacing } = useTheme();
  const reduceMotion = useReducedMotion();
  const a = useSharedValue(0);
  const b = useSharedValue(0);
  const c = useSharedValue(0);

  useEffect(() => {
    const values = [a, b, c];
    if (reduceMotion) {
      values.forEach((v) => v.set(0.6));
      return;
    }
    values.forEach((v, i) =>
      v.set(
        withDelay(
          i * 140,
          withRepeat(
            withSequence(
              withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) }),
              withTiming(0, { duration: 320 }),
            ),
            -1,
            false,
          ),
        ),
      ),
    );
    return () => values.forEach((v) => cancelAnimation(v));
  }, [a, b, c, reduceMotion]);

  return (
    <Animated.View
      entering={reduceMotion ? FadeIn : FadeInDown.springify().damping(18)}
      exiting={FadeOut.duration(150)}
      style={{ paddingHorizontal: spacing.md, marginBottom: spacing.sm }}
      accessibilityLabel="Typing"
      accessibilityLiveRegion="polite"
    >
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: colors.bubbleIncoming,
            borderRadius: radii.bubble,
            borderBottomLeftRadius: radii.bubbleTail,
            gap: 5,
          },
        ]}
      >
        <Dot value={a} color={colors.textSecondary} />
        <Dot value={b} color={colors.textSecondary} />
        <Dot value={c} color={colors.textSecondary} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
