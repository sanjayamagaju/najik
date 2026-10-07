import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, useReducedMotion } from 'react-native-reanimated';

import { routes } from '@/navigation/routes';

import { isLive } from '../model/callMachine';
import { callController } from '../services/callService';
import { useCallStore } from '../store/callStore';

import { IncomingCallView } from './IncomingCallView';

/**
 * Mounted once above every signed-in screen (like the Ping overlay):
 *  - shows the full-screen incoming call UI from any screen while a call rings,
 *  - opens the call screen once a call is live but the screen isn't (answered from the
 *    notification / CallKit, or after a cold start).
 */
export function IncomingCallOverlay() {
  const machine = useCallStore((s) => s.machine);
  const screenOpen = useCallStore((s) => s.screenOpen);
  const reduceMotion = useReducedMotion();
  const { phase, peer, media, direction } = machine;

  useEffect(() => {
    if (screenOpen || !peer) return;
    if (direction === 'incoming' && isLive(phase) && phase !== 'incoming') {
      router.push(routes.call(peer.id, media));
    }
  }, [phase, direction, peer, media, screenOpen]);

  if (phase !== 'incoming' || screenOpen || !peer) return null;

  return (
    <Animated.View
      entering={reduceMotion ? FadeIn.duration(150) : SlideInDown.springify().damping(20)}
      exiting={FadeOut.duration(180)}
      style={[StyleSheet.absoluteFill, styles.root]}
    >
      <IncomingCallView
        peer={peer}
        media={media}
        onAccept={() => {
          void callController.accept();
        }}
        onDecline={() => callController.decline()}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({ root: { zIndex: 3000 } });
