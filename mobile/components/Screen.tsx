import { type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/useTheme';

export interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  /** Wraps content in a KeyboardAvoidingView (forms). */
  keyboard?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

/** Safe-area aware screen container that centers content on tablets. */
export function Screen({
  children,
  scroll = false,
  edges = ['bottom'],
  keyboard = false,
  contentStyle,
}: ScreenProps) {
  const { colors, spacing, layout } = useTheme();
  const inner = [
    {
      width: '100%' as const,
      maxWidth: layout.maxContentWidth,
      alignSelf: 'center' as const,
      padding: spacing.lg,
    },
    contentStyle,
  ];
  const content = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[{ flexGrow: 1 }, inner]}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, inner]}>{children}</View>
  );
  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: colors.background }]}>
      {keyboard ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
