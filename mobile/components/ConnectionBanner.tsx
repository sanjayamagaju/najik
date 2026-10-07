import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useReducedMotion,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/useTheme';
import {
  type ConnectionBanner as BannerKind,
  deriveConnectionBanner,
  useConnectionStore,
} from '@/store/connectionStore';

import { Icon } from './Icon';
import { Text } from './Text';

const COLD_START_GRACE_MS = 1200;
const ONLINE_FLASH_MS = 1500;

/** Visible banner state: hides the steady "online" state, flashes it after a recovery. */
export function useConnectionBanner(): BannerKind {
  const wsState = useConnectionStore((s) => s.wsState);
  const network = useConnectionStore((s) => s.networkAvailable);
  const everConnected = useConnectionStore((s) => s.everConnected);
  const raw = deriveConnectionBanner(wsState, network);
  const [shown, setShown] = useState<BannerKind>(null);
  const lastShown = useRef<BannerKind>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (value: BannerKind) => {
      lastShown.current = value;
      setShown(value);
    };
    if (raw === 'online') {
      if (lastShown.current === 'offline' || lastShown.current === 'connecting') {
        show('online');
        timer = setTimeout(() => show(null), ONLINE_FLASH_MS);
      } else {
        show(null);
      }
    } else if (raw === 'connecting' && !everConnected) {
      timer = setTimeout(() => show('connecting'), COLD_START_GRACE_MS);
    } else {
      show(raw);
    }
    return () => clearTimeout(timer);
  }, [raw, everConnected]);

  return shown;
}

/** Animated "Waiting for network… / Connecting… / Online" strip. */
export function ConnectionBanner() {
  const banner = useConnectionBanner();
  const { colors, spacing, motion } = useTheme();
  const reduceMotion = useReducedMotion();
  if (!banner) return null;

  const config = {
    offline: { label: 'Waiting for network…', bg: colors.surfaceSunken, fg: colors.textSecondary },
    connecting: { label: 'Connecting…', bg: colors.primarySoft, fg: colors.primary },
    online: { label: 'Online', bg: colors.success, fg: '#FFFFFF' },
  }[banner];

  return (
    <Animated.View
      entering={FadeIn.duration(motion.duration.base)}
      exiting={FadeOut.duration(motion.duration.base)}
      layout={reduceMotion ? undefined : LinearTransition.duration(motion.duration.base)}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={config.label}
      style={[
        styles.root,
        { backgroundColor: config.bg, paddingVertical: spacing.xs + 2, gap: spacing.sm },
      ]}
    >
      {banner === 'connecting' ? (
        <ActivityIndicator size="small" color={config.fg} />
      ) : (
        <View>
          <Icon
            name={banner === 'offline' ? 'cloud-offline-outline' : 'checkmark-circle'}
            size={14}
            tint={config.fg}
          />
        </View>
      )}
      <Text variant="caption" tint={config.fg}>
        {config.label}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
