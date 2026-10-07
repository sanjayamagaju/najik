import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/useTheme';

import { Text } from './Text';

export interface BadgeProps {
  count: number;
  muted?: boolean;
}

/** Unread counter that pops when the count increases. */
export function Badge({ count, muted = false }: BadgeProps) {
  const { colors, motion } = useTheme();
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const prev = useRef(count);

  useEffect(() => {
    if (count > prev.current && !reduceMotion) {
      scale.set(
        withSequence(
          withTiming(1.25, { duration: motion.duration.instant }),
          withSpring(1, motion.spring.bouncy),
        ),
      );
    }
    prev.current = count;
  }, [count, reduceMotion, scale, motion]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  if (count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <Animated.View
      accessibilityLabel={`${count} unread`}
      style={[
        styles.badge,
        { backgroundColor: muted ? colors.textTertiary : colors.primary },
        style,
      ]}
    >
      <Text
        variant="micro"
        tint={colors.onPrimary}
        maxFontSizeMultiplier={1.2}
        style={styles.label}
      >
        {label}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontFamily: 'Inter_700Bold' },
});
