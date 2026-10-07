import { router } from 'expo-router';
import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInUp,
  FadeOut,
  FadeOutUp,
  LinearTransition,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/useTheme';
import { routes } from '@/navigation/routes';
import { type Toast, useUiStore } from '@/store/uiStore';

import { Avatar } from './Avatar';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

const ICONS: Record<Toast['kind'], IconName> = {
  info: 'information-circle',
  success: 'checkmark-circle',
  error: 'alert-circle',
  message: 'chatbubble-ellipses',
  ping: 'radio',
};

const ToastCard = memo(function ToastCard({ toast }: { toast: Toast }) {
  const { colors, radii, spacing, elevation } = useTheme();
  const reduceMotion = useReducedMotion();
  const dismiss = useUiStore((s) => s.dismissToast);

  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, dismiss]);

  const tint =
    toast.kind === 'error'
      ? colors.danger
      : toast.kind === 'success'
        ? colors.success
        : toast.kind === 'ping'
          ? colors.accent
          : colors.primary;

  return (
    <Animated.View
      entering={reduceMotion ? FadeIn : FadeInUp.springify().damping(18)}
      exiting={reduceMotion ? FadeOut : FadeOutUp.duration(180)}
      layout={reduceMotion ? undefined : LinearTransition.springify().damping(20)}
    >
      <PressableScale
        accessibilityRole={toast.conversationId ? 'button' : 'alert'}
        accessibilityLabel={[toast.title, toast.body].filter(Boolean).join('. ')}
        accessibilityHint={toast.conversationId ? 'Opens the chat' : 'Dismisses the notice'}
        onPress={() => {
          dismiss(toast.id);
          if (toast.conversationId) router.push(routes.chat(toast.conversationId));
        }}
        style={[
          styles.card,
          elevation.md,
          {
            backgroundColor: colors.surfaceElevated,
            borderRadius: radii.lg,
            padding: spacing.md,
            gap: spacing.md,
            borderColor: colors.border,
          },
        ]}
      >
        {toast.avatar ? (
          <Avatar name={toast.avatar.display_name} color={toast.avatar.avatar_color} size={36} />
        ) : (
          <Icon name={ICONS[toast.kind]} size={26} tint={tint} />
        )}
        <View style={styles.text}>
          <Text variant="subhead" numberOfLines={1}>
            {toast.title}
          </Text>
          {toast.body ? (
            <Text variant="footnote" color="textSecondary" numberOfLines={2}>
              {toast.body}
            </Text>
          ) : null}
        </View>
      </PressableScale>
    </Animated.View>
  );
});

/** In-app toasts (errors, message previews for other chats, ping notices). */
export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  const insets = useSafeAreaInsets();
  const { spacing, layout } = useTheme();
  if (toasts.length === 0) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.host,
        { top: insets.top + spacing.sm, paddingHorizontal: spacing.md, gap: spacing.sm },
      ]}
    >
      <View
        pointerEvents="box-none"
        style={{ width: '100%', maxWidth: layout.maxContentWidth, gap: spacing.sm }}
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 1000 },
  card: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  text: { flex: 1, gap: 2 },
});
