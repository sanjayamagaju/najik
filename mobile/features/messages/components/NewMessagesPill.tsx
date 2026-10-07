import { StyleSheet } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useReducedMotion,
} from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/useTheme';

export interface NewMessagesPillProps {
  count: number;
  onPress: () => void;
}

/** Floating "N new messages ↓" pill when new messages arrive while scrolled up. */
export function NewMessagesPill({ count, onPress }: NewMessagesPillProps) {
  const { colors, spacing, radii, elevation } = useTheme();
  const reduceMotion = useReducedMotion();
  const label =
    count > 0
      ? `${count > 99 ? '99+' : count} new message${count === 1 ? '' : 's'}`
      : 'Jump to latest';
  return (
    <Animated.View
      entering={reduceMotion ? FadeIn : SlideInDown.springify().damping(18)}
      exiting={reduceMotion ? FadeOut : SlideOutDown.duration(160)}
      style={styles.wrap}
      pointerEvents="box-none"
    >
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[
          styles.pill,
          elevation.md,
          {
            backgroundColor: count > 0 ? colors.primary : colors.surfaceElevated,
            borderRadius: radii.pill,
            paddingHorizontal: spacing.lg,
            gap: spacing.xs,
          },
        ]}
      >
        <Text variant="subhead" tint={count > 0 ? colors.onPrimary : colors.text}>
          {label}
        </Text>
        <Icon name="arrow-down" size={16} tint={count > 0 ? colors.onPrimary : colors.text} />
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', bottom: 12, alignSelf: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', height: 40 },
});
