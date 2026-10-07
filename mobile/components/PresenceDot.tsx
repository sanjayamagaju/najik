import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/useTheme';

export interface PresenceDotProps {
  online: boolean;
  size?: number;
  /** Ring color separating the dot from the avatar (usually the surface behind it). */
  ringColor?: string;
}

/** Green online dot that springs in and emits a single soft pulse when a contact comes online. */
export function PresenceDot({ online, size = 14, ringColor }: PresenceDotProps) {
  const { colors, motion } = useTheme();
  const reduceMotion = useReducedMotion();
  const visible = useSharedValue(online ? 1 : 0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      visible.set(withTiming(online ? 1 : 0, { duration: motion.duration.fast }));
      return;
    }
    visible.set(
      online
        ? withSpring(1, motion.spring.bouncy)
        : withTiming(0, { duration: motion.duration.fast }),
    );
    if (online) {
      pulse.set(0);
      pulse.set(
        withSequence(
          withTiming(1, { duration: 900, easing: motion.easing.decelerate }),
          withTiming(0, { duration: 0 }),
        ),
      );
    }
  }, [online, reduceMotion, visible, pulse, motion]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: visible.get(),
    transform: [{ scale: reduceMotion ? 1 : 0.4 + 0.6 * visible.get() }],
  }));
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulse.get() === 0 ? 0 : 0.5 * (1 - pulse.get()),
    transform: [{ scale: 1 + pulse.get() * 1.4 }],
  }));

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      <Animated.View
        style={[
          styles.fill,
          { borderRadius: size / 2, backgroundColor: colors.online },
          pulseStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.fill,
          {
            borderRadius: size / 2,
            backgroundColor: colors.online,
            borderWidth: 2,
            borderColor: ringColor ?? colors.background,
          },
          dotStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill },
});
