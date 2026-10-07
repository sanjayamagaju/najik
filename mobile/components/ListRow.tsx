import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';

import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface ListRowProps {
  icon?: IconName;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  destructive?: boolean;
  showChevron?: boolean;
  accessibilityHint?: string;
}

/** Settings-style row. */
export function ListRow({
  icon,
  title,
  subtitle,
  value,
  onPress,
  right,
  destructive,
  showChevron = !!onPress,
  accessibilityHint,
}: ListRowProps) {
  const { colors, spacing, radii } = useTheme();
  const tint = destructive ? colors.danger : colors.primary;
  const body = (
    <View
      style={[
        styles.row,
        { gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
      ]}
    >
      {icon ? (
        <View
          style={[
            styles.icon,
            {
              backgroundColor: destructive ? colors.dangerSoft : colors.primarySoft,
              borderRadius: radii.sm,
            },
          ]}
        >
          <Icon name={icon} size={18} tint={tint} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text variant="body" tint={destructive ? colors.danger : undefined} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="textSecondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="callout" color="textTertiary" numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right}
      {showChevron ? <Icon name="chevron-forward" size={18} color="textTertiary" /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <PressableScale
      pressedScale={0.98}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, value].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
    >
      {body}
    </PressableScale>
  );
}

export function ListSection({
  title,
  children,
  footer,
}: {
  title?: string;
  children: ReactNode;
  footer?: string;
}) {
  const { colors, spacing, radii } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      {title ? (
        <Text
          variant="caption"
          color="textTertiary"
          style={{ marginLeft: spacing.lg, textTransform: 'uppercase', letterSpacing: 0.6 }}
        >
          {title}
        </Text>
      ) : null}
      <View style={{ backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden' }}>
        {children}
      </View>
      {footer ? (
        <Text variant="caption" color="textTertiary" style={{ marginHorizontal: spacing.lg }}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  icon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
});
