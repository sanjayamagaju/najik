import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  type TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { useTheme } from '@/hooks/useTheme';
import { ApiError, describeError } from '@/services/api/errors';

import { AuthHero } from '../components/AuthHero';
import { register } from '../services/authService';
import {
  DISPLAY_NAME_MAX,
  type FormErrors,
  hasErrors,
  PASSWORD_MIN,
  type RegisterForm,
  validateRegisterForm,
} from '../validation';

const SERVER_FIELD: Record<string, keyof RegisterForm> = {
  username: 'username',
  display_name: 'displayName',
  password: 'password',
  email: 'email',
};

export function RegisterScreen() {
  const { colors, spacing, layout } = useTheme();
  const insets = useSafeAreaInsets();
  const [values, setValues] = useState<RegisterForm>({
    username: '',
    displayName: '',
    password: '',
    email: '',
  });
  const [errors, setErrors] = useState<FormErrors<RegisterForm>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);

  const set = (key: keyof RegisterForm) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async () => {
    const next = validateRegisterForm(values);
    setErrors(next);
    setFormError(null);
    if (hasErrors(next)) return;
    setSubmitting(true);
    try {
      await register(values);
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === 'username_taken' || error.code === 'conflict')
      ) {
        // 409 details: {"username":["username_taken"]} or {"email":["email_taken"]}
        const fieldErrors: FormErrors<RegisterForm> = {};
        if (error.details.email) fieldErrors.email = 'That email is already in use';
        if (error.details.username || !error.details.email)
          fieldErrors.username = 'That username is taken';
        setErrors(fieldErrors);
      } else if (
        error instanceof ApiError &&
        error.code === 'validation_error' &&
        Object.keys(error.details).length > 0
      ) {
        const fieldErrors: FormErrors<RegisterForm> = {};
        for (const [field, messages] of Object.entries(error.details)) {
          const key = SERVER_FIELD[field];
          if (key && messages[0]) fieldErrors[key] = messages[0];
        }
        setErrors(fieldErrors);
        if (!hasErrors(fieldErrors)) setFormError(error.message);
      } else {
        setFormError(describeError(error));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <AuthHero
          title="Join Najik"
          subtitle="Messages, Pings and calls with the people who matter."
        />
        <View
          style={{
            padding: spacing.xxl,
            gap: spacing.lg,
            width: '100%',
            maxWidth: layout.maxContentWidth,
            alignSelf: 'center',
          }}
        >
          <TextField
            label="Your name"
            value={values.displayName}
            onChangeText={set('displayName')}
            error={errors.displayName}
            maxLength={DISPLAY_NAME_MAX}
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            onSubmitEditing={() => usernameRef.current?.focus()}
          />
          <TextField
            ref={usernameRef}
            label="Username"
            value={values.username}
            onChangeText={set('username')}
            error={errors.username}
            hint="3–24 letters, numbers, _ or ."
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username-new"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <TextField
            ref={passwordRef}
            label="Password"
            value={values.password}
            onChangeText={set('password')}
            error={errors.password}
            hint={`At least ${PASSWORD_MIN} characters`}
            secureToggle
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
          />
          <TextField
            ref={emailRef}
            label="Email (optional)"
            value={values.email}
            onChangeText={set('email')}
            error={errors.email}
            hint="Only used to help you recover your account"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />
          {formError ? (
            <Text variant="footnote" color="danger" accessibilityRole="alert">
              {formError}
            </Text>
          ) : null}
          <Button title="Create account" loading={submitting} onPress={() => void submit()} />
          <View style={[styles.row, { gap: spacing.xs }]}>
            <Text variant="callout" color="textSecondary">
              Already have an account?
            </Text>
            <Button title="Sign in" variant="ghost" size="md" onPress={() => router.back()} />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
});
