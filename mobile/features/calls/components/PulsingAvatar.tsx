import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Avatar } from '@/components/Avatar';

import { CALL_SURFACE } from './callSurface';

const PULSE_MS = 2_200;

function Ring({ progress, size }: { progress: SharedValue<number>; size: number }) {
  const style = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - progress.get()),
    transform: [{ scale: 1 + progress.get() * 0.75 }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2, borderColor: CALL_SURFACE.ring },
        style,
      ]}
    />
  );
}

/** Peer avatar with expanding rings while calling/ringing; static under reduced motion. */
export const PulsingAvatar = memo(function PulsingAvatar({
  name,
  color,
  size = 132,
  pulsing,
}: {
  name: string;
  color: string;
  size?: number;
  pulsing: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const a = useSharedValue(0);
  const b = useSharedValue(0);
  const animate = pulsing && !reduceMotion;

  useEffect(() => {
    if (!animate) {
      cancelAnimation(a);
      cancelAnimation(b);
      a.set(0);
      b.set(0);
      return;
    }
    const loop = (delay: number) =>
      withDelay(
        delay,
        withRepeat(
          withTiming(1, { duration: PULSE_MS, easing: Easing.out(Easing.quad) }),
          -1,
          false,
        ),
      );
    a.set(loop(0));
    b.set(loop(PULSE_MS / 2));
    return () => {
      cancelAnimation(a);
      cancelAnimation(b);
    };
  }, [animate, a, b]);

  return (
    <View style={[styles.root, { width: size * 1.9, height: size * 1.9 }]}>
      {animate ? (
        <>
          <Ring progress={a} size={size} />
          <Ring progress={b} size={size} />
        </>
      ) : (
        <View
          style={[
            styles.ring,
            styles.staticRing,
            { width: size + 20, height: size + 20, borderRadius: (size + 20) / 2 },
          ]}
        />
      )}
      <Avatar name={name} color={color} size={size} />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 2 },
  staticRing: { borderColor: 'rgba(150,113,255,0.35)' },
});
