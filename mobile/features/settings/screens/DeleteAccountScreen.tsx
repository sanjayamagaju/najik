import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { deleteAccount } from '@/features/auth/services/authService';
import { useTheme } from '@/hooks/useTheme';
import { ApiError, describeError } from '@/services/api/errors';
import { toast } from '@/store/uiStore';

/** Account deletion (App Store / Play requirement) with password + explicit confirmation. */
export function DeleteAccountScreen() {
  const { colors, spacing, radii } = useTheme();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const run = async () => {
    setDeleting(true);
    try {
      await deleteAccount(password);
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === 'invalid_credentials' ||
          err.code === 'validation_error' ||
          err.status === 403)
      ) {
        setError(err.fieldError('password') ?? 'Incorrect password');
      } else {
        toast.error("Couldn't delete account", describeError(err));
      }
      setDeleting(false);
    }
  };

  const confirm = () => {
    if (!password) {
      setError('Enter your password to confirm');
      return;
    }
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your account, chats and messages. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete forever', style: 'destructive', onPress: () => void run() },
      ],
    );
  };

  return (
    <Screen scroll keyboard>
      <View style={{ gap: spacing.xl }}>
        <View
          style={[
            styles.warning,
            {
              backgroundColor: colors.dangerSoft,
              borderRadius: radii.lg,
              padding: spacing.lg,
              gap: spacing.md,
            },
          ]}
        >
          <Icon name="warning-outline" size={24} color="danger" />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text variant="headline" color="danger">
              This can’t be undone
            </Text>
            <Text variant="footnote" color="textSecondary">
              Your profile, conversations and messages will be permanently deleted, and you’ll be
              signed out of every device.
            </Text>
          </View>
        </View>
        <TextField
          label="Password"
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            if (error) setError(null);
          }}
          error={error}
          secureToggle
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
        />
        <Button title="Delete my account" variant="danger" loading={deleting} onPress={confirm} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  warning: { flexDirection: 'row', alignItems: 'flex-start' },
});
