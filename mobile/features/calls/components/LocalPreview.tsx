import { memo, useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RTCView } from 'react-native-webrtc';

import { Icon } from '@/components/Icon';
import { motion } from '@/constants/theme';

import { CALL_SURFACE } from './callSurface';

const WIDTH = 108;
const HEIGHT = 160;
const MARGIN = 12;

/**
 * Draggable self-view that snaps to the nearest corner (UI-thread gesture + spring). Mirrored
 * for the front camera, like a mirror; the remote side always sees the unmirrored image.
 */
export const LocalPreview = memo(function LocalPreview({
  streamUrl,
  mirror,
  cameraOn,
  bottomInset,
}: {
  streamUrl: string | null;
  mirror: boolean;
  cameraOn: boolean;
  /** Space reserved at the bottom (controls). */
  bottomInset: number;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const minX = MARGIN + insets.left;
  const maxX = width - WIDTH - MARGIN - insets.right;
  const minY = insets.top + 64;
  const maxY = height - HEIGHT - bottomInset;

  const x = useSharedValue(maxX);
  const y = useSharedValue(minY);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  // Keep the tile inside the screen when the controls show/hide or the screen rotates.
  useEffect(() => {
    const snapX = x.get() < (minX + maxX) / 2 ? minX : maxX;
    const snapY = y.get() < (minY + maxY) / 2 ? minY : maxY;
    x.set(reduceMotion ? snapX : withSpring(snapX, motion.spring.gentle));
    y.set(reduceMotion ? snapY : withSpring(snapY, motion.spring.gentle));
  }, [minX, maxX, minY, maxY, reduceMotion, x, y]);

  const pan = Gesture.Pan()
    .onBegin(() => {
      startX.set(x.get());
      startY.set(y.get());
    })
    .onUpdate((e) => {
      x.set(startX.get() + e.translationX);
      y.set(startY.get() + e.translationY);
    })
    .onEnd((e) => {
      // Project the fling a little so a flick lands in the corner it points at.
      const projectedX = x.get() + e.velocityX * 0.12;
      const projectedY = y.get() + e.velocityY * 0.12;
      const snapX = projectedX < (minX + maxX) / 2 ? minX : maxX;
      const snapY = projectedY < (minY + maxY) / 2 ? minY : maxY;
      if (reduceMotion) {
        x.set(withTiming(snapX, { duration: 120 }));
        y.set(withTiming(snapY, { duration: 120 }));
      } else {
        x.set(withSpring(snapX, { ...motion.spring.snappy, velocity: e.velocityX }));
        y.set(withSpring(snapY, { ...motion.spring.snappy, velocity: e.velocityY }));
      }
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.tile, style]}
        accessible
        accessibilityLabel={cameraOn ? 'Your camera preview. Drag to move.' : 'Your camera is off'}
        testID="local-preview"
      >
        {cameraOn && streamUrl ? (
          <RTCView
            streamURL={streamUrl}
            style={StyleSheet.absoluteFill}
            objectFit="cover"
            mirror={mirror}
            zOrder={1}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.off]}>
            <Icon name="videocam-off" size={26} tint={CALL_SURFACE.textSecondary} />
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  tile: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: WIDTH,
    height: HEIGHT,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#1B1A27',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  off: { alignItems: 'center', justifyContent: 'center' },
});
