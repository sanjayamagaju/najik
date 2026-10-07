import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/useTheme';

import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityHint?: string;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  loading = false,
  disabled = false,
  icon,
  style,
  testID,
  accessibilityHint,
}: ButtonProps) {
  const { colors, gradients, radii, spacing } = useTheme();
  const height = size === 'lg' ? 52 : 44;
  const fg =
    variant === 'primary'
      ? colors.onPrimary
      : variant === 'danger'
        ? colors.danger
        : variant === 'secondary'
          ? colors.primary
          : colors.textSecondary;
  const bg =
    variant === 'secondary'
      ? colors.primarySoft
      : variant === 'danger'
        ? colors.dangerSoft
        : 'transparent';

  const content = (
    <View style={[styles.row, { gap: spacing.sm }]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={18} tint={fg} /> : null}
          <Text variant="bodyStrong" tint={fg} numberOfLines={1}>
            {title}
          </Text>
        </>
      )}
    </View>
  );

  return (
    <PressableScale
      testID={testID}
      onPress={loading ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy: loading }}
      style={[{ borderRadius: radii.pill, overflow: 'hidden', minHeight: height }, style]}
    >
      {variant === 'primary' ? (
        <LinearGradient
          colors={gradients.brand}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.fill, { minHeight: height, paddingHorizontal: spacing.xl }]}
        >
          {content}
        </LinearGradient>
      ) : (
        <View
          style={[
            styles.fill,
            { minHeight: height, backgroundColor: bg, paddingHorizontal: spacing.xl },
          ]}
        >
          {content}
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  fill: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
