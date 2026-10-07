import { useRef, useState } from 'react';
import { type TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { useTheme } from '@/hooks/useTheme';
import { ApiError, describeError } from '@/services/api/errors';

import {
  type FormErrors,
  hasErrors,
  type LoginForm as LoginValues,
  validateLoginForm,
} from '../validation';

export interface LoginFormProps {
  onSubmit: (values: LoginValues) => Promise<void>;
}

export function mapLoginError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'invalid_credentials' || error.status === 401)
      return 'Wrong username or password.';
    if (error.code === 'rate_limited') return describeError(error);
  }
  return describeError(error);
}

export function LoginForm({ onSubmit }: LoginFormProps) {
  const { spacing } = useTheme();
  const [values, setValues] = useState<LoginValues>({ username: '', password: '' });
  const [errors, setErrors] = useState<FormErrors<LoginValues>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const set = (key: keyof LoginValues) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async () => {
    const nextErrors = validateLoginForm(values);
    setErrors(nextErrors);
    setFormError(null);
    if (hasErrors(nextErrors)) return;
    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (error) {
      setFormError(mapLoginError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <TextField
        testID="login-username"
        label="Username"
        value={values.username}
        onChangeText={set('username')}
        error={errors.username}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <TextField
        ref={passwordRef}
        testID="login-password"
        label="Password"
        value={values.password}
        onChangeText={set('password')}
        error={errors.password}
        secureToggle
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      {formError ? (
        <Text variant="footnote" color="danger" accessibilityRole="alert" testID="login-error">
          {formError}
        </Text>
      ) : null}
      <Button
        title="Sign in"
        loading={submitting}
        onPress={() => void submit()}
        testID="login-submit"
      />
    </View>
  );
}
