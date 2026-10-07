import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ZoomIn, useReducedMotion } from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/hooks/useTheme';
import type { MessageStatus } from '@/types/protocol';

const ICON: Record<MessageStatus, IconName> = {
  sending: 'time-outline',
  failed: 'alert-circle',
  sent: 'checkmark',
  delivered: 'checkmark-done',
  read: 'checkmark-done',
};

export const STATUS_LABEL: Record<MessageStatus, string> = {
  sending: 'Sending',
  failed: 'Not sent',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
};

export interface StatusTicksProps {
  status: MessageStatus;
  /** Tick color on the bubble (read ticks use the accent color). */
  baseColor: string;
}

/**
 * Derived delivery status. Each status change re-mounts the icon (keyed by status) so it
 * morphs in with a spring pop — or a fade with reduced motion.
 */
export const StatusTicks = memo(function StatusTicks({ status, baseColor }: StatusTicksProps) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const tint =
    status === 'read' ? colors.tickRead : status === 'failed' ? colors.danger : baseColor;
  return (
    <View
      style={styles.box}
      accessible
      accessibilityRole="image"
      accessibilityLabel={STATUS_LABEL[status]}
      testID={`status-${status}`}
    >
      <Animated.View
        key={status}
        entering={
          reduceMotion ? FadeIn.duration(120) : ZoomIn.springify().damping(14).stiffness(260)
        }
      >
        <Icon name={ICON[status]} size={status === 'sending' ? 13 : 16} tint={tint} />
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  box: { minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
});
