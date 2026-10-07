import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/hooks/useTheme';
import { useUiStore } from '@/store/uiStore';
import { haptics } from '@/utils/haptics';

import { getPingCooldownRemaining, PING_COOLDOWN_MS, sendPing } from '../pingService';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface PingButtonProps {
  conversationId: string;
  size?: number;
  testID?: string;
}

/**
 * The Ping button: a gently "breathing" gradient orb. Pressing it fires a ripple burst, and a
 * ring drains around it while the 5 s server-side cooldown runs (or a longer rate-limit wait).
 */
export function PingButton({ conversationId, size = 44, testID = 'ping-button' }: PingButtonProps) {
  const { colors, gradients, motion } = useTheme();
  const reduceMotion = useReducedMotion();
  const cooldownUntil = useUiStore((s) => s.pingCooldownUntil[conversationId] ?? 0);
  // `now` only advances when a cooldown expires, so render stays pure.
  const [now, setNow] = useState(() => Date.now());
  const coolingDown = cooldownUntil > now;

  const breathe = useSharedValue(0);
  const burst = useSharedValue(0);
  const ring = useSharedValue(0); // 1 = full cooldown remaining, 0 = ready

  useEffect(() => {
    if (reduceMotion) return;
    breathe.set(
      withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }), -1, true),
    );
    return () => cancelAnimation(breathe);
  }, [reduceMotion, breathe]);

  useEffect(() => {
    const remaining = cooldownUntil - Date.now();
    if (remaining <= 0) {
      ring.set(0);
      return;
    }
    const total = Math.max(PING_COOLDOWN_MS, remaining);
    ring.set(remaining / total);
    ring.set(withTiming(0, { duration: remaining, easing: Easing.linear }));
    const timer = setTimeout(() => setNow(Date.now()), remaining + 16);
    return () => clearTimeout(timer);
  }, [cooldownUntil, ring]);

  const stroke = 3;
  const radius = (size + 8 - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - ring.get()),
  }));

  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reduceMotion ? 1 : 1 + breathe.get() * 0.04 }],
  }));
  const burstStyle = useAnimatedStyle(() => ({
    opacity: burst.get() === 0 ? 0 : 0.55 * (1 - burst.get()),
    transform: [{ scale: 1 + burst.get() * 1.6 }],
  }));

  const onPress = async () => {
    if (getPingCooldownRemaining(conversationId) > 0) {
      haptics.warning();
      return;
    }
    haptics.medium();
    if (!reduceMotion) {
      burst.set(0);
      burst.set(
        withSequence(
          withTiming(1, { duration: 650, easing: motion.easing.decelerate }),
          withTiming(0, { duration: 0 }),
        ),
      );
    } else {
      burst.set(withSequence(withSpring(0.3), withTiming(0, { duration: 200 })));
    }
    await sendPing(conversationId);
  };

  return (
    <View
      style={{ width: size + 8, height: size + 8, alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { margin: 4, borderRadius: size, backgroundColor: colors.accent },
          burstStyle,
        ]}
      />
      <Svg width={size + 8} height={size + 8} style={StyleSheet.absoluteFill} pointerEvents="none">
        <AnimatedCircle
          cx={(size + 8) / 2}
          cy={(size + 8) / 2}
          r={radius}
          stroke={colors.accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={ringProps}
          transform={`rotate(-90 ${(size + 8) / 2} ${(size + 8) / 2})`}
        />
      </Svg>
      <PressableScale
        testID={testID}
        onPress={() => void onPress()}
        accessibilityRole="button"
        accessibilityLabel="Ping"
        accessibilityHint={
          coolingDown ? 'Ping is cooling down' : 'Sends a Ping that makes their phone buzz'
        }
        accessibilityState={{ disabled: coolingDown }}
        pressedScale={0.88}
      >
        <Animated.View
          style={[
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              overflow: 'hidden',
              opacity: coolingDown ? 0.65 : 1,
            },
            orbStyle,
          ]}
        >
          <LinearGradient
            colors={gradients.ping}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.orb}
          >
            <Icon name="radio" size={Math.round(size * 0.48)} tint="#FFFFFF" />
          </LinearGradient>
        </Animated.View>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  orb: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
