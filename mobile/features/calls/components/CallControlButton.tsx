import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/useTheme';

import { CALL_SURFACE } from './callSurface';

export interface CallControlButtonProps {
  icon: IconName;
  label: string;
  onPress?: () => void;
  /** Toggle state (e.g. muted) — rendered as an inverted (white) button. */
  active?: boolean;
  variant?: 'default' | 'danger' | 'accept';
  size?: number;
  disabled?: boolean;
  /** Spoken label when it differs from the visible caption. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Hang-up glyph: the handset rotated down. */
  rotateIcon?: boolean;
  testID?: string;
}

/** Round in-call control with a caption; toggles expose their state to screen readers. */
export const CallControlButton = memo(function CallControlButton({
  icon,
  label,
  onPress,
  active,
  variant = 'default',
  size = 64,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  rotateIcon,
  testID,
}: CallControlButtonProps) {
  const { colors, spacing } = useTheme();
  const background =
    variant === 'danger'
      ? colors.danger
      : variant === 'accept'
        ? colors.success
        : active
          ? CALL_SURFACE.controlActive
          : CALL_SURFACE.control;
  const tint = active && variant === 'default' ? CALL_SURFACE.controlActiveIcon : '#FFFFFF';
  const isToggle = active !== undefined;
  return (
    <View style={[styles.wrap, { gap: spacing.xs }]}>
      <PressableScale
        testID={testID}
        onPress={onPress}
        disabled={disabled}
        hitSlop={6}
        accessibilityRole={isToggle ? 'switch' : 'button'}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={
          isToggle ? { checked: !!active, disabled: !!disabled } : { disabled: !!disabled }
        }
        style={[
          styles.button,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: background },
        ]}
      >
        <View style={rotateIcon ? styles.rotated : undefined}>
          <Icon name={icon} size={Math.round(size * 0.42)} tint={tint} />
        </View>
      </PressableScale>
      <Text
        variant="caption"
        tint={CALL_SURFACE.textSecondary}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
      >
        {label}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', minWidth: 68 },
  button: { alignItems: 'center', justifyContent: 'center' },
  rotated: { transform: [{ rotate: '135deg' }] },
});
