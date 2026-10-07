import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';

const LABELS = ['very poor', 'poor', 'fair', 'good', 'excellent'] as const;

/** Four signal bars for the call's network quality (0 … 4). */
export const NetworkQualityBars = memo(function NetworkQualityBars({
  level,
  size = 14,
}: {
  level: 0 | 1 | 2 | 3 | 4;
  size?: number;
}) {
  const { colors } = useTheme();
  const tint = level >= 3 ? colors.success : level === 2 ? colors.warning : colors.danger;
  const barWidth = Math.max(2, Math.round(size / 5));
  return (
    <View
      style={[styles.row, { height: size, gap: Math.max(1, Math.round(barWidth / 2)) }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Network quality ${LABELS[level]}`}
      testID="network-quality"
    >
      {[1, 2, 3, 4].map((bar) => (
        <View
          key={bar}
          style={{
            width: barWidth,
            height: Math.round((size * bar) / 4),
            borderRadius: barWidth / 2,
            backgroundColor: bar <= Math.max(level, 1) ? tint : 'rgba(255,255,255,0.28)',
          }}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'flex-end' } });
