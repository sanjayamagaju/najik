import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { changePassword } from '@/features/auth/services/authService';
import { validatePassword } from '@/features/auth/validation';
import { useTheme } from '@/hooks/useTheme';
import { ApiError, describeError } from '@/services/api/errors';
import { toast } from '@/store/uiStore';
import { haptics } from '@/utils/haptics';

export function ChangePasswordScreen() {
  const { spacing } = useTheme();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const e: typeof errors = {};
    if (!current) e.current = 'Enter your current password';
    const nextError = validatePassword(next);
    if (nextError) e.next = nextError;
    else if (next === current) e.next = 'Choose a different password';
    if (confirm !== next) e.confirm = "Passwords don't match";
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSubmitting(true);
    try {
      await changePassword(current, next);
      haptics.success();
      toast.success('Password changed', 'Your other devices were signed out.');
      router.back();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'validation_error') {
        setErrors({
          current: error.fieldError('current_password'),
          next:
            error.fieldError('new_password') ??
            (error.fieldError('current_password') ? undefined : error.message),
        });
      } else if (
        error instanceof ApiError &&
        (error.code === 'invalid_credentials' || error.status === 403)
      ) {
        setErrors({ current: 'Current password is incorrect' });
      } else {
        toast.error("Couldn't change password", describeError(error));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll keyboard>
      <View style={{ gap: spacing.lg }}>
        <Text variant="callout" color="textSecondary">
          Changing your password signs out all your other devices.
        </Text>
        <TextField
          label="Current password"
          value={current}
          onChangeText={setCurrent}
          error={errors.current}
          secureToggle
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
        />
        <TextField
          label="New password"
          value={next}
          onChangeText={setNext}
          error={errors.next}
          secureToggle
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          hint="At least 8 characters"
        />
        <TextField
          label="Confirm new password"
          value={confirm}
          onChangeText={setConfirm}
          error={errors.confirm}
          secureToggle
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          onSubmitEditing={() => void submit()}
        />
        <Button title="Change password" loading={submitting} onPress={() => void submit()} />
      </View>
    </Screen>
  );
}
