import { type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/useTheme';

import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/** Modal bottom sheet with backdrop; slides up (fades under reduced motion). */
export function Sheet({ visible, onClose, title, children }: SheetProps) {
  const { colors, radii, spacing, layout } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      {visible ? (
        <View style={styles.root}>
          <Animated.View
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(160)}
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
            />
          </Animated.View>
          <Animated.View
            entering={reduceMotion ? FadeIn : SlideInDown.springify().damping(22).stiffness(220)}
            exiting={reduceMotion ? FadeOut : SlideOutDown.duration(200)}
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                backgroundColor: colors.surfaceElevated,
                borderTopLeftRadius: radii.xl,
                borderTopRightRadius: radii.xl,
                paddingBottom: insets.bottom + spacing.md,
                paddingHorizontal: spacing.lg,
                maxWidth: layout.maxContentWidth,
              },
            ]}
          >
            <View
              style={[
                styles.grabber,
                { backgroundColor: colors.borderStrong, marginVertical: spacing.sm },
              ]}
            />
            {title ? (
              <Text
                variant="headline"
                align="center"
                style={{ marginBottom: spacing.sm }}
                accessibilityRole="header"
              >
                {title}
              </Text>
            ) : null}
            {children}
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}

export interface SheetActionProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

export function SheetAction({ icon, label, onPress, destructive }: SheetActionProps) {
  const { colors, spacing, radii } = useTheme();
  const tint = destructive ? colors.danger : colors.text;
  return (
    <PressableScale
      pressedScale={0.98}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.action,
        {
          gap: spacing.md,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.sm,
          borderRadius: radii.md,
        },
      ]}
    >
      <Icon name={icon} size={22} tint={tint} />
      <Text variant="body" tint={tint}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%' },
  grabber: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center' },
  action: { flexDirection: 'row', alignItems: 'center' },
});
