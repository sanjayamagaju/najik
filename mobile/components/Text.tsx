import { memo } from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import {
  type ColorTokens,
  MAX_FONT_SCALE,
  typography,
  type TypographyVariant,
} from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  color?: keyof ColorTokens;
  /** Raw color override (e.g. on gradient surfaces). */
  tint?: string;
  align?: TextStyle['textAlign'];
}

/** Typography primitive: every piece of text goes through the type scale and color tokens. */
export const Text = memo(function Text({
  variant = 'body',
  color = 'text',
  tint,
  align,
  style,
  maxFontSizeMultiplier = MAX_FONT_SCALE,
  ...rest
}: TextProps) {
  const { colors } = useTheme();
  return (
    <RNText
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[typography[variant], { color: tint ?? colors[color], textAlign: align }, style]}
    />
  );
});
