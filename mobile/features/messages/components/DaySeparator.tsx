import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/useTheme';
import { formatDayLabel } from '@/utils/date';

export const DaySeparator = memo(function DaySeparator({ at }: { at: string }) {
  const { colors, spacing, radii } = useTheme();
  const label = formatDayLabel(at);
  return (
    <View
      style={[styles.row, { marginVertical: spacing.md }]}
      accessibilityRole="header"
      accessibilityLabel={label}
    >
      <View
        style={[
          styles.pill,
          {
            backgroundColor: colors.surface,
            borderRadius: radii.pill,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs,
          },
        ]}
      >
        <Text variant="caption" color="textSecondary">
          {label}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { alignItems: 'center' },
  pill: {},
});
