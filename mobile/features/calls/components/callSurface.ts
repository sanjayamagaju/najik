/**
 * The call UI is always immersive-dark (like the system call screens), independent of the app
 * theme, so video and avatars read well. Brand violet comes from the design tokens' palette.
 */
export const CALL_SURFACE = {
  gradient: ['#2A1F8F', '#14102E', '#0B0A12'] as const,
  scrim: 'rgba(8,7,16,0.55)',
  scrimStrong: 'rgba(8,7,16,0.78)',
  control: 'rgba(255,255,255,0.16)',
  controlActive: '#FFFFFF',
  controlActiveIcon: '#14121F',
  chip: 'rgba(20,18,31,0.62)',
  text: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.78)',
  textTertiary: 'rgba(255,255,255,0.56)',
  ring: '#9671FF',
} as const;
