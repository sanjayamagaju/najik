import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import type { ColorTokens } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export interface IconProps {
  name: IconName;
  size?: number;
  color?: keyof ColorTokens;
  tint?: string;
}

/** Icon primitive (Ionicons — consistent on both platforms, bundled, works offline). */
export function Icon({ name, size = 22, color = 'text', tint }: IconProps) {
  const { colors } = useTheme();
  return (
    <Ionicons
      name={name}
      size={size}
      color={tint ?? colors[color]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
