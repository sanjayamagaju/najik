import { View } from 'react-native';

import { Skeleton } from '@/components/Skeleton';
import { useTheme } from '@/hooks/useTheme';

const WIDTHS = ['72%', '54%', '80%', '62%', '68%', '50%', '76%'] as const;

export function ChatsSkeleton() {
  const { spacing } = useTheme();
  return (
    <View accessibilityLabel="Loading chats" accessibilityRole="progressbar">
      {WIDTHS.map((w, i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
          }}
        >
          <Skeleton width={54} height={54} radius={27} />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Skeleton width="45%" height={14} />
            <Skeleton width={w} height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}
