import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import type { ColorTokens } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';

export interface IconButtonProps {
  icon: IconName;
  onPress?: () => void;
  accessibilityLabel: string;
  size?: number;
  color?: keyof ColorTokens;
  tint?: string;
  variant?: 'plain' | 'tonal' | 'filled';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  size = 22,
  color,
  tint,
  variant = 'plain',
  disabled,
  style,
  testID,
}: IconButtonProps) {
  const { colors, layout } = useTheme();
  const background =
    variant === 'filled'
      ? colors.primary
      : variant === 'tonal'
        ? colors.primarySoft
        : 'transparent';
  const iconColor =
    tint ?? (color ? colors[color] : variant === 'filled' ? colors.onPrimary : colors.primary);
  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={[
        styles.base,
        {
          minWidth: layout.minTouchTarget,
          minHeight: layout.minTouchTarget,
          backgroundColor: background,
        },
        style,
      ]}
    >
      <Icon name={icon} size={size} tint={iconColor} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
});
