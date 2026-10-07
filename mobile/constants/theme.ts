import { Easing } from 'react-native-reanimated';

/**
 * Najik design tokens. Every visual value in the app comes from here.
 * Brand: deep violet → indigo, with a warm "ping" coral accent.
 */

const palette = {
  violet50: '#F4F1FF',
  violet100: '#E9E3FF',
  violet200: '#D3C6FF',
  violet300: '#B49EFF',
  violet400: '#9671FF',
  violet500: '#7B4DFF',
  violet600: '#6C47FF',
  violet700: '#5533E0',
  violet800: '#3F2FD1',
  violet900: '#2A1F8F',
  indigo500: '#4F46E5',
  indigo600: '#4338CA',
  coral400: '#FF8A6B',
  coral500: '#FF6B4A',
  cyan200: '#A5F3FC',
  green500: '#22C55E',
  green600: '#16A34A',
  red500: '#E5484D',
  amber500: '#F5A524',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export interface ColorTokens {
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceSunken: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  onPrimary: string;
  accent: string;
  accentSoft: string;
  success: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  online: string;
  bubbleOutgoingText: string;
  bubbleOutgoingMeta: string;
  bubbleIncoming: string;
  bubbleIncomingText: string;
  bubbleIncomingMeta: string;
  tickRead: string;
  skeleton: string;
  skeletonHighlight: string;
  overlay: string;
  tabBar: string;
  inputBackground: string;
  separator: string;
}

const light: ColorTokens = {
  background: '#FFFFFF',
  surface: '#F7F6FC',
  surfaceElevated: '#FFFFFF',
  surfaceSunken: '#EFEDF7',
  border: '#E7E4F1',
  borderStrong: '#D3CFE3',
  text: '#14121F',
  textSecondary: '#5E5A72',
  textTertiary: '#9893AD',
  textInverse: '#FFFFFF',
  primary: palette.violet600,
  primaryPressed: palette.violet700,
  primarySoft: palette.violet50,
  onPrimary: palette.white,
  accent: palette.coral500,
  accentSoft: '#FFF0EB',
  success: palette.green600,
  danger: palette.red500,
  dangerSoft: '#FDECEC',
  warning: palette.amber500,
  online: palette.green500,
  bubbleOutgoingText: palette.white,
  bubbleOutgoingMeta: 'rgba(255,255,255,0.72)',
  bubbleIncoming: '#F1EFF8',
  bubbleIncomingText: '#14121F',
  bubbleIncomingMeta: '#8C88A3',
  tickRead: palette.cyan200,
  skeleton: '#EEEBF6',
  skeletonHighlight: '#F8F7FC',
  overlay: 'rgba(12,10,24,0.45)',
  tabBar: 'rgba(255,255,255,0.96)',
  inputBackground: '#F3F1FA',
  separator: '#EEECF5',
};

const dark: ColorTokens = {
  background: '#0B0A12',
  surface: '#13121C',
  surfaceElevated: '#1B1A27',
  surfaceSunken: '#08070D',
  border: '#262435',
  borderStrong: '#363349',
  text: '#F4F3FA',
  textSecondary: '#A9A5BE',
  textTertiary: '#6E6A84',
  textInverse: '#14121F',
  primary: palette.violet500,
  primaryPressed: palette.violet600,
  primarySoft: '#221B42',
  onPrimary: palette.white,
  accent: palette.coral400,
  accentSoft: '#3A1E18',
  success: palette.green500,
  danger: '#FF6369',
  dangerSoft: '#3B1719',
  warning: palette.amber500,
  online: palette.green500,
  bubbleOutgoingText: palette.white,
  bubbleOutgoingMeta: 'rgba(255,255,255,0.7)',
  bubbleIncoming: '#1E1C2B',
  bubbleIncomingText: '#F4F3FA',
  bubbleIncomingMeta: '#8A86A0',
  tickRead: palette.cyan200,
  skeleton: '#1C1A28',
  skeletonHighlight: '#27253A',
  overlay: 'rgba(0,0,0,0.6)',
  tabBar: 'rgba(19,18,28,0.96)',
  inputBackground: '#1B1A27',
  separator: '#1E1C2A',
};

export const colors = { light, dark } as const;

/** Brand gradients (start → end), used for outgoing bubbles, primary buttons and the ping wave. */
export type Gradient = readonly [string, string];

export interface GradientTokens {
  brand: Gradient;
  ping: Gradient;
}

const lightGradients: GradientTokens = {
  brand: [palette.violet500, palette.indigo600],
  ping: [palette.coral400, palette.violet500],
};

const darkGradients: GradientTokens = {
  brand: [palette.violet600, palette.violet900],
  ping: [palette.coral400, palette.violet600],
};

export const gradients = { light: lightGradients, dark: darkGradients } as const;

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export interface TypographyToken {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
}

export const typography = {
  display: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 38, letterSpacing: -0.6 },
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  headline: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20 },
  subhead: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19 },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  micro: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 13, letterSpacing: 0.2 },
} satisfies Record<string, TypographyToken>;

export type TypographyVariant = keyof typeof typography;

/** Upper bound for Dynamic Type / font scale so layouts stay intact at accessibility sizes. */
export const MAX_FONT_SCALE = 1.6;

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radii = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  bubble: 20,
  bubbleTail: 6,
  pill: 999,
} as const;

export const elevation = {
  none: { shadowOpacity: 0, elevation: 0 },
  sm: {
    shadowColor: '#1A1033',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: '#1A1033',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  lg: {
    shadowColor: '#1A1033',
    shadowOpacity: 0.2,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
} as const;

export const motion = {
  duration: { instant: 90, fast: 150, base: 240, slow: 380, ping: 1400, shimmer: 1200 },
  easing: {
    standard: Easing.bezier(0.2, 0, 0, 1),
    emphasized: Easing.bezier(0.3, 0, 0, 1),
    decelerate: Easing.out(Easing.cubic),
    accelerate: Easing.in(Easing.cubic),
  },
  spring: {
    snappy: { damping: 18, stiffness: 320, mass: 0.8 },
    gentle: { damping: 20, stiffness: 180, mass: 1 },
    bouncy: { damping: 11, stiffness: 240, mass: 0.9 },
  },
  pressScale: 0.96,
} as const;

/** Layout breakpoints (dp) for small phones and tablets. */
export const layout = {
  smallPhoneMaxWidth: 360,
  tabletMinWidth: 700,
  maxContentWidth: 720,
  maxBubbleWidthRatio: 0.78,
  minTouchTarget: 44,
} as const;

export type ColorScheme = 'light' | 'dark';

export interface Theme {
  scheme: ColorScheme;
  colors: ColorTokens;
  gradients: GradientTokens;
  typography: typeof typography;
  spacing: typeof spacing;
  radii: typeof radii;
  elevation: typeof elevation;
  motion: typeof motion;
  layout: typeof layout;
}

export function buildTheme(scheme: ColorScheme): Theme {
  return {
    scheme,
    colors: colors[scheme],
    gradients: gradients[scheme],
    typography,
    spacing,
    radii,
    elevation,
    motion,
    layout,
  };
}
