import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/useTheme';
import { routes } from '@/navigation/routes';
import { useAuthStore } from '@/store/authStore';

import { AuthHero } from '../components/AuthHero';
import { LoginForm } from '../components/LoginForm';
import { login } from '../services/authService';

export function LoginScreen() {
  const { colors, spacing, radii, layout } = useTheme();
  const insets = useSafeAreaInsets();
  const reason = useAuthStore((s) => s.lastSignOutReason);
  const notice =
    reason === 'forced'
      ? 'Your session ended on this device. Please sign in again.'
      : reason === 'account_deleted'
        ? 'Your account has been deleted.'
        : null;

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <AuthHero title="Welcome back" subtitle="Your people, one tap away." />
        <View
          style={{
            padding: spacing.xxl,
            gap: spacing.xl,
            width: '100%',
            maxWidth: layout.maxContentWidth,
            alignSelf: 'center',
          }}
        >
          {notice ? (
            <View
              style={[
                styles.notice,
                {
                  backgroundColor: colors.primarySoft,
                  borderRadius: radii.md,
                  padding: spacing.md,
                  gap: spacing.sm,
                },
              ]}
              accessibilityRole="alert"
            >
              <Icon name="information-circle" size={18} color="primary" />
              <Text variant="footnote" style={styles.flex}>
                {notice}
              </Text>
            </View>
          ) : null}
          <LoginForm
            onSubmit={async (values) => {
              useAuthStore.getState().clearSignOutReason();
              await login(values);
            }}
          />
          <View style={[styles.row, { gap: spacing.xs }]}>
            <Text variant="callout" color="textSecondary">
              New to Najik?
            </Text>
            <Button
              title="Create an account"
              variant="ghost"
              size="md"
              onPress={() => router.push(routes.register)}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
  notice: { flexDirection: 'row', alignItems: 'center' },
});
