import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { updateDisplayName } from '@/features/auth/services/authService';
import { DISPLAY_NAME_MAX, validateDisplayName } from '@/features/auth/validation';
import { useTheme } from '@/hooks/useTheme';
import { ApiError, describeError } from '@/services/api/errors';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { haptics } from '@/utils/haptics';

export function EditProfileScreen() {
  const { spacing } = useTheme();
  const user = useAuthStore((s) => s.user);
  const [name, setName] = useState(user?.display_name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user) return null;
  const unchanged = name.trim() === user.display_name;

  const save = async () => {
    const e = validateDisplayName(name);
    setError(e);
    if (e || unchanged) return;
    setSaving(true);
    try {
      await updateDisplayName(name);
      haptics.success();
      toast.success('Profile updated');
      router.back();
    } catch (err) {
      if (err instanceof ApiError && err.fieldError('display_name'))
        setError(err.fieldError('display_name') ?? null);
      else toast.error("Couldn't save", describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen scroll keyboard>
      <View style={{ gap: spacing.xl }}>
        <View style={{ alignItems: 'center', gap: spacing.sm }}>
          <Avatar name={name.trim() || user.display_name} color={user.avatar_color} size={96} />
          <Text variant="callout" color="textSecondary">
            @{user.username}
          </Text>
        </View>
        <TextField
          label="Display name"
          value={name}
          onChangeText={(v) => {
            setName(v);
            if (error) setError(null);
          }}
          error={error}
          maxLength={DISPLAY_NAME_MAX}
          hint="This is how people see you in their chats"
          autoComplete="name"
          textContentType="name"
          returnKeyType="done"
          onSubmitEditing={() => void save()}
        />
        <Button title="Save" loading={saving} disabled={unchanged} onPress={() => void save()} />
      </View>
    </Screen>
  );
}
