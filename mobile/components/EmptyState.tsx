import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion, FadeIn } from 'react-native-reanimated';

import { useTheme } from '@/hooks/useTheme';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, message, actionLabel, onAction }: EmptyStateProps) {
  const { colors, spacing } = useTheme();
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      entering={reduceMotion ? FadeIn : FadeInDown.springify().damping(18)}
      style={[styles.root, { gap: spacing.md, padding: spacing.xxl }]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.primarySoft }]}>
        <Icon name={icon} size={36} color="primary" />
      </View>
      <Text variant="title" align="center" accessibilityRole="header">
        {title}
      </Text>
      <Text variant="callout" color="textSecondary" align="center" style={{ maxWidth: 320 }}>
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Button
          title={actionLabel}
          onPress={onAction}
          style={{ marginTop: spacing.sm, alignSelf: 'center' }}
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
