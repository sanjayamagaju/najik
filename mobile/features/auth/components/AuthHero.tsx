import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/useTheme';

const MARK = require('@/assets/images/splash-icon.png') as number;

export function AuthHero({ title, subtitle }: { title: string; subtitle: string }) {
  const { gradients, spacing, radii } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  return (
    <LinearGradient
      colors={gradients.brand}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.hero,
        {
          paddingTop: insets.top + spacing.xxl,
          paddingBottom: spacing.xxxl + spacing.lg,
          paddingHorizontal: spacing.xxl,
          borderBottomLeftRadius: radii.xl,
          borderBottomRightRadius: radii.xl,
        },
      ]}
    >
      <Animated.View
        entering={reduceMotion ? FadeIn : FadeInDown.springify().damping(16)}
        style={{ gap: spacing.md }}
      >
        <View style={styles.markWrap}>
          <Image
            source={MARK}
            style={styles.mark}
            contentFit="contain"
            accessibilityIgnoresInvertColors
            accessible={false}
          />
        </View>
        <Text variant="display" tint="#FFFFFF" accessibilityRole="header">
          {title}
        </Text>
        <Text variant="callout" tint="rgba(255,255,255,0.85)">
          {subtitle}
        </Text>
      </Animated.View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  hero: {},
  markWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: { width: 40, height: 40 },
});
