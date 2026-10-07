import * as Application from 'expo-application';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { ListRow, ListSection } from '@/components/ListRow';
import { PressableScale } from '@/components/PressableScale';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Text } from '@/components/Text';
import { configResult } from '@/config/env';
import { logout, setMessagePreview } from '@/features/auth/services/authService';
import { describeError } from '@/services/api/errors';
import { useTheme } from '@/hooks/useTheme';
import { routes } from '@/navigation/routes';
import {
  getPermissionState,
  type PermissionState,
  registerDeviceToken,
  requestPermission,
} from '@/services/notifications';
import { useAuthStore } from '@/store/authStore';
import { type ThemePreference, useSettingsStore } from '@/store/settingsStore';
import { toast } from '@/store/uiStore';

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const satisfies readonly { value: ThemePreference; label: string }[];

export function SettingsScreen() {
  const { colors, spacing, radii, layout } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const theme = useSettingsStore((s) => s.theme);
  const hapticsOn = useSettingsStore((s) => s.haptics);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [savingPreview, setSavingPreview] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getPermissionState()
        .then(setPermission)
        .catch(() => setPermission(null));
    }, []),
  );

  const enableNotifications = async () => {
    if (permission === 'denied') {
      await Linking.openSettings();
      return;
    }
    const state = await requestPermission();
    setPermission(state);
    if (state === 'granted') {
      await registerDeviceToken();
      toast.success('Notifications on');
    }
  };

  const confirmLogout = () => {
    Alert.alert('Sign out?', 'Unsent messages on this device will be discarded.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          setSigningOut(true);
          logout().finally(() => setSigningOut(false));
        },
      },
    ]);
  };

  const env = configResult.ok ? configResult.config.appEnv : 'unknown';

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.sm,
        paddingBottom: insets.bottom + spacing.huge,
        paddingHorizontal: spacing.lg,
        gap: spacing.xl,
        width: '100%',
        maxWidth: layout.maxContentWidth,
        alignSelf: 'center',
      }}
    >
      <Text variant="display" accessibilityRole="header">
        Settings
      </Text>

      {user ? (
        <PressableScale
          pressedScale={0.98}
          onPress={() => router.push(routes.editProfile)}
          accessibilityRole="button"
          accessibilityLabel={`${user.display_name}, @${user.username}. Edit profile`}
          style={[
            styles.profile,
            {
              backgroundColor: colors.surface,
              borderRadius: radii.xl,
              padding: spacing.lg,
              gap: spacing.lg,
            },
          ]}
        >
          <Avatar name={user.display_name} color={user.avatar_color} size={64} />
          <View style={styles.flex}>
            <Text variant="title" numberOfLines={1}>
              {user.display_name}
            </Text>
            <Text variant="callout" color="textSecondary" numberOfLines={1}>
              @{user.username}
            </Text>
            {user.email ? (
              <Text variant="footnote" color="textTertiary" numberOfLines={1}>
                {user.email}
              </Text>
            ) : null}
          </View>
          <Text variant="subhead" color="primary">
            Edit
          </Text>
        </PressableScale>
      ) : null}

      <ListSection title="Appearance">
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Text variant="body">Theme</Text>
          <SegmentedControl
            accessibilityLabel="Theme"
            options={THEME_OPTIONS}
            value={theme}
            onChange={(value) => useSettingsStore.getState().setTheme(value)}
          />
        </View>
        <ListRow
          icon="pulse-outline"
          title="Haptics"
          subtitle="Subtle vibrations for sends, Pings and taps"
          right={
            <Switch
              value={hapticsOn}
              onValueChange={(v) => useSettingsStore.getState().setHaptics(v)}
              trackColor={{ true: colors.primary, false: colors.borderStrong }}
              thumbColor="#FFFFFF"
              accessibilityLabel="Haptics"
            />
          }
        />
      </ListSection>

      <ListSection
        title="Notifications"
        footer={
          permission === 'denied' ? 'Notifications are turned off in system settings.' : undefined
        }
      >
        <ListRow
          icon="notifications-outline"
          title="Push notifications"
          value={
            permission === 'granted'
              ? 'On'
              : permission === 'denied'
                ? 'Off'
                : permission === 'undetermined'
                  ? 'Not set'
                  : undefined
          }
          onPress={permission === 'granted' ? undefined : () => void enableNotifications()}
          showChevron={permission !== 'granted'}
          accessibilityHint={
            permission === 'denied' ? 'Opens system settings' : 'Asks for permission'
          }
        />
        <ListRow
          icon="eye-outline"
          title="Show message previews"
          subtitle="Include message text in notifications"
          right={
            <Switch
              value={user?.show_message_preview ?? true}
              disabled={savingPreview}
              onValueChange={(v) => {
                setSavingPreview(true);
                setMessagePreview(v)
                  .catch((e: unknown) => toast.error("Couldn't update setting", describeError(e)))
                  .finally(() => setSavingPreview(false));
              }}
              trackColor={{ true: colors.primary, false: colors.borderStrong }}
              thumbColor="#FFFFFF"
              accessibilityLabel="Show message previews"
            />
          }
        />
      </ListSection>

      <ListSection title="Privacy & security">
        <ListRow
          icon="phone-portrait-outline"
          title="Devices & sessions"
          onPress={() => router.push(routes.sessions)}
        />
        <ListRow
          icon="key-outline"
          title="Change password"
          onPress={() => router.push(routes.changePassword)}
        />
      </ListSection>

      <ListSection>
        <ListRow
          icon="log-out-outline"
          title={signingOut ? 'Signing out…' : 'Sign out'}
          onPress={signingOut ? undefined : confirmLogout}
          destructive
          showChevron={false}
        />
        <ListRow
          icon="trash-outline"
          title="Delete account"
          onPress={() => router.push(routes.deleteAccount)}
          destructive
        />
      </ListSection>

      <Text variant="caption" color="textTertiary" align="center">
        Najik {Application.nativeApplicationVersion ?? ''} ({Application.nativeBuildVersion ?? '—'})
        {env !== 'production' ? ` · ${env}` : ''}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  profile: { flexDirection: 'row', alignItems: 'center' },
});
