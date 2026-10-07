import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { motion } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import type { CallMedia } from '@/types/protocol';

import type { CallPeer } from '../model/callMachine';

import { CallControlButton } from './CallControlButton';
import { CALL_SURFACE } from './callSurface';
import { PulsingAvatar } from './PulsingAvatar';

const SWIPE_TO_ANSWER = 70;

/** Full-screen incoming call: swipe up or tap to answer, tap to decline. */
export function IncomingCallView({
  peer,
  media,
  onAccept,
  onDecline,
}: {
  peer: CallPeer;
  media: CallMedia;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const lift = useSharedValue(0);
  const drag = useSharedValue(0);

  // A gentle "lift me" hop on the answer button.
  useEffect(() => {
    if (reduceMotion) return;
    lift.set(
      withRepeat(
        withSequence(
          withTiming(-10, { duration: 260 }),
          withSpring(0, motion.spring.bouncy),
          withTiming(0, { duration: 900 }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(lift);
  }, [reduceMotion, lift]);

  const swipe = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .onUpdate((e) => {
      drag.set(Math.min(0, e.translationY));
    })
    .onEnd((e) => {
      if (e.translationY < -SWIPE_TO_ANSWER || e.velocityY < -900) {
        scheduleOnRN(onAccept);
      }
      drag.set(withSpring(0, motion.spring.snappy));
    });

  const answerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.get() + drag.get() }],
  }));

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal testID="incoming-call">
      <LinearGradient colors={CALL_SURFACE.gradient} style={StyleSheet.absoluteFill} />
      <View
        style={[
          styles.top,
          { paddingTop: insets.top + spacing.huge, gap: spacing.sm, paddingHorizontal: spacing.xl },
        ]}
      >
        <Text variant="subhead" tint={CALL_SURFACE.textSecondary}>
          {media === 'video' ? 'Najik video call' : 'Najik voice call'}
        </Text>
        <Text
          variant="display"
          tint={CALL_SURFACE.text}
          align="center"
          numberOfLines={2}
          accessibilityRole="header"
          accessibilityLabel={`Incoming ${media === 'video' ? 'video' : 'voice'} call from ${peer.display_name}`}
        >
          {peer.display_name}
        </Text>
      </View>
      <View style={styles.center}>
        <PulsingAvatar name={peer.display_name} color={peer.avatar_color} size={136} pulsing />
      </View>
      <View
        style={[
          styles.actions,
          { paddingBottom: insets.bottom + spacing.huge, paddingHorizontal: spacing.huge },
        ]}
      >
        <CallControlButton
          testID="incoming-decline"
          icon="call"
          rotateIcon
          label="Decline"
          accessibilityLabel="Decline call"
          variant="danger"
          size={72}
          onPress={onDecline}
        />
        <View style={styles.answerCol}>
          {!reduceMotion ? (
            <View style={[styles.hint, { marginBottom: spacing.sm }]}>
              <Icon name="chevron-up" size={18} tint={CALL_SURFACE.textTertiary} />
            </View>
          ) : null}
          <GestureDetector gesture={swipe}>
            <Animated.View style={answerStyle}>
              <CallControlButton
                testID="incoming-accept"
                icon={media === 'video' ? 'videocam' : 'call'}
                label="Answer"
                accessibilityLabel="Answer call"
                accessibilityHint="Double tap, or swipe up, to answer"
                variant="accept"
                size={72}
                onPress={onAccept}
              />
            </Animated.View>
          </GestureDetector>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  answerCol: { alignItems: 'center' },
  hint: { alignItems: 'center' },
});
