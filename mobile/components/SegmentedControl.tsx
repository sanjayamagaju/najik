import { useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/useTheme';
import { haptics } from '@/utils/haptics';

import { Text } from './Text';

export interface SegmentedControlProps<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}

/** Segmented control with a spring-animated thumb. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  const { colors, radii, spacing, motion, elevation } = useTheme();
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const segment = options.length > 0 ? (width - 8) / options.length : 0;

  const thumbStyle = useAnimatedStyle(() => ({
    width: segment,
    transform: [
      {
        translateX: reduceMotion
          ? withTiming(index * segment, { duration: motion.duration.fast })
          : withSpring(index * segment, motion.spring.snappy),
      },
    ],
  }));

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={[
        styles.root,
        { backgroundColor: colors.surfaceSunken, borderRadius: radii.md, padding: 4 },
      ]}
    >
      {width > 0 ? (
        <Animated.View
          style={[
            styles.thumb,
            elevation.sm,
            { backgroundColor: colors.surfaceElevated, borderRadius: radii.sm },
            thumbStyle,
          ]}
        />
      ) : null}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => {
              if (selected) return;
              haptics.selection();
              onChange(o.value);
            }}
            style={[styles.option, { paddingVertical: spacing.sm }]}
          >
            <Text variant="subhead" color={selected ? 'text' : 'textSecondary'}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row' },
  thumb: { position: 'absolute', top: 4, bottom: 4, left: 4 },
  option: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
