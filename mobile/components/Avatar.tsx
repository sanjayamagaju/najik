import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { initials } from '@/utils/text';

import { PresenceDot } from './PresenceDot';
import { Text } from './Text';

export interface AvatarProps {
  name: string;
  color: string;
  size?: number;
  online?: boolean;
  /** Background behind the avatar, used for the presence dot ring. */
  ringColor?: string;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Initials avatar on the user's `avatar_color`, with a soft sheen and optional presence dot. */
export const Avatar = memo(function Avatar({
  name,
  color,
  size = 48,
  online,
  ringColor,
}: AvatarProps) {
  const { colors } = useTheme();
  const base = HEX.test(color) ? color : colors.primary;
  const dotSize = Math.max(10, Math.round(size * 0.28));
  const fontSize = Math.round(size * 0.38);
  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[
          styles.circle,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: base },
        ]}
      >
        <LinearGradient
          colors={['rgba(255,255,255,0.28)', 'rgba(255,255,255,0)']}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Text
          variant="headline"
          tint="#FFFFFF"
          maxFontSizeMultiplier={1}
          style={{ fontSize, lineHeight: Math.round(fontSize * 1.2) }}
        >
          {initials(name)}
        </Text>
      </View>
      {online !== undefined ? (
        <View style={styles.dot}>
          <PresenceDot online={online} size={dotSize} ringColor={ringColor} />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  dot: { position: 'absolute', right: 0, bottom: 0 },
});
