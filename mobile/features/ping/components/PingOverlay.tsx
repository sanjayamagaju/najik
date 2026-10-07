import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  ZoomIn,
  type SharedValue,
} from 'react-native-reanimated';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/useTheme';
import { routes } from '@/navigation/routes';
import { useUiStore } from '@/store/uiStore';
import { haptics } from '@/utils/haptics';

const AUTO_DISMISS_MS = 4_000;
const WAVE_MS = 1_400;

function Wave({
  progress,
  color,
  size,
}: {
  progress: SharedValue<number>;
  color: string;
  size: number;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - progress.get()),
    transform: [{ scale: 0.35 + progress.get() * 1.9 }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wave,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: color,
          backgroundColor: `${color}22`,
        },
        style,
      ]}
    />
  );
}

/**
 * Receiver-side Ping experience, mounted once above all screens: expanding waves around the
 * sender's avatar plus a haptic pattern. Reduced motion shows a static card instead.
 */
export function PingOverlay() {
  const event = useUiStore((s) => s.pingOverlay);
  const dismiss = useUiStore((s) => s.dismissPingOverlay);
  const { colors, spacing, radii, elevation } = useTheme();
  const reduceMotion = useReducedMotion();
  const w1 = useSharedValue(0);
  const w2 = useSharedValue(0);
  const w3 = useSharedValue(0);

  useEffect(() => {
    if (!event) return;
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    const echo = setTimeout(() => haptics.heavy(), 180);
    if (!reduceMotion) {
      const wave = (delay: number) =>
        withDelay(
          delay,
          withRepeat(
            withTiming(1, { duration: WAVE_MS, easing: Easing.out(Easing.quad) }),
            3,
            false,
          ),
        );
      w1.set(0);
      w2.set(0);
      w3.set(0);
      w1.set(wave(0));
      w2.set(wave(WAVE_MS / 3));
      w3.set(wave((2 * WAVE_MS) / 3));
    }
    return () => {
      clearTimeout(timer);
      clearTimeout(echo);
      cancelAnimation(w1);
      cancelAnimation(w2);
      cancelAnimation(w3);
    };
  }, [event, dismiss, reduceMotion, w1, w2, w3]);

  if (!event) return null;
  const size = 220;

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(220)}
      style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: colors.overlay }]}
      accessibilityViewIsModal
      accessibilityLiveRegion="assertive"
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss ping"
      />
      <View style={styles.center} pointerEvents="box-none">
        {!reduceMotion ? (
          <View style={[styles.waves, { width: size, height: size }]} pointerEvents="none">
            <Wave progress={w1} color={colors.accent} size={size} />
            <Wave progress={w2} color={colors.primary} size={size} />
            <Wave progress={w3} color={colors.accent} size={size} />
          </View>
        ) : null}
        <Animated.View entering={reduceMotion ? FadeIn : ZoomIn.springify().damping(12)}>
          <Avatar name={event.from.display_name} color={event.from.avatar_color} size={96} />
        </Animated.View>
      </View>
      <Animated.View
        entering={FadeIn.delay(120)}
        style={[
          styles.card,
          elevation.lg,
          {
            backgroundColor: colors.surfaceElevated,
            borderRadius: radii.xl,
            padding: spacing.xl,
            gap: spacing.md,
            marginBottom: spacing.huge,
          },
        ]}
      >
        <Text variant="title" align="center" accessibilityRole="header">
          {event.from.display_name} pinged you
        </Text>
        <Text variant="callout" color="textSecondary" align="center">
          They want your attention.
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button title="Later" variant="ghost" size="md" onPress={dismiss} style={{ flex: 1 }} />
          <Button
            title="Open chat"
            size="md"
            icon="chatbubble-ellipses"
            style={{ flex: 1 }}
            onPress={() => {
              dismiss();
              router.push(routes.chat(event.conversationId));
            }}
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 2000, justifyContent: 'flex-end', alignItems: 'center' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  waves: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  wave: { position: 'absolute', borderWidth: 2 },
  card: { width: '88%', maxWidth: 420 },
});
