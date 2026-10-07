import { type ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { motion } from '@/constants/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** Scale while pressed (default 0.96). */
  pressedScale?: number;
}

/** Pressable with a UI-thread spring press-scale; falls back to an opacity dip with reduced motion. */
export function PressableScale({
  style,
  children,
  pressedScale = motion.pressScale,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableScaleProps) {
  const reduceMotion = useReducedMotion();
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => {
    const p = pressed.get();
    if (reduceMotion) return { opacity: 1 - p * 0.25 };
    return { transform: [{ scale: 1 - p * (1 - pressedScale) }] };
  });

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        pressed.set(
          reduceMotion
            ? withTiming(1, { duration: motion.duration.instant })
            : withSpring(1, motion.spring.snappy),
        );
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.set(
          reduceMotion
            ? withTiming(0, { duration: motion.duration.fast })
            : withSpring(0, motion.spring.snappy),
        );
        onPressOut?.(e);
      }}
      style={[style, animatedStyle, disabled ? { opacity: 0.5 } : null]}
    >
      {children}
    </AnimatedPressable>
  );
}
