import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/useTheme';

import { type CallMachineState, callDurationSec, endCopy } from '../model/callMachine';
import { formatCallDuration } from '../model/qualityUi';

import { CALL_SURFACE } from './callSurface';

const AUTO_CLOSE_MS = 6_000;

/** Call summary / failure explanation with "Call again" when it makes sense. */
export function CallEndedView({
  machine,
  onClose,
  onCallAgain,
}: {
  machine: CallMachineState;
  onClose: () => void;
  onCallAgain: () => void;
}) {
  const { spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const copy = endCopy(machine);
  const duration = callDurationSec(machine, machine.endedAt ?? 0);
  const permission = machine.endReason === 'permission_denied';

  useEffect(() => {
    if (copy.silent) {
      onClose();
      return;
    }
    if (permission) return; // let the user read it and open Settings
    const timer = setTimeout(onClose, AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [copy.silent, permission, onClose]);

  if (copy.silent) return null;
  const peer = machine.peer;

  return (
    <View style={StyleSheet.absoluteFill} testID="call-ended">
      <LinearGradient colors={CALL_SURFACE.gradient} style={StyleSheet.absoluteFill} />
      <Animated.View
        entering={reduceMotion ? FadeIn : FadeInDown.springify().damping(18)}
        style={[styles.body, { gap: spacing.md, paddingHorizontal: spacing.xxl }]}
      >
        {peer ? <Avatar name={peer.display_name} color={peer.avatar_color} size={96} /> : null}
        <Text
          variant="title"
          tint={CALL_SURFACE.text}
          align="center"
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
        >
          {copy.title}
        </Text>
        {machine.endReason === 'completed' && duration > 0 ? (
          <Text variant="headline" tint={CALL_SURFACE.textSecondary}>
            {formatCallDuration(duration)}
          </Text>
        ) : null}
        {copy.body ? (
          <Text variant="callout" tint={CALL_SURFACE.textSecondary} align="center">
            {copy.body}
          </Text>
        ) : null}
      </Animated.View>
      <View
        style={[
          styles.actions,
          {
            gap: spacing.sm,
            paddingBottom: insets.bottom + spacing.xxl,
            paddingHorizontal: spacing.xl,
          },
        ]}
      >
        {permission ? (
          <Button
            title="Open Settings"
            icon="settings-outline"
            onPress={() => void Linking.openSettings()}
          />
        ) : copy.canRetry && peer ? (
          <Button
            title="Call again"
            icon={machine.media === 'video' ? 'videocam' : 'call'}
            onPress={onCallAgain}
          />
        ) : null}
        <Button title="Close" variant="secondary" onPress={onClose} testID="call-ended-close" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  actions: { width: '100%', maxWidth: 420, alignSelf: 'center' },
});
