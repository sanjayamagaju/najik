import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeOut, LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { ListSection } from '@/components/ListRow';
import { Skeleton } from '@/components/Skeleton';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/useTheme';
import { authApi } from '@/services/api/endpoints';
import { describeError } from '@/services/api/errors';
import { toast } from '@/store/uiStore';
import type { Session } from '@/types/protocol';
import { formatListTimestamp } from '@/utils/date';
import { haptics } from '@/utils/haptics';

function SessionRow({ session, onRevoke }: { session: Session; onRevoke?: (s: Session) => void }) {
  const { colors, spacing } = useTheme();
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      exiting={reduceMotion ? undefined : FadeOut.duration(180)}
      layout={reduceMotion ? undefined : LinearTransition.springify().damping(20)}
      style={[styles.row, { padding: spacing.lg, gap: spacing.md }]}
      accessible
      accessibilityLabel={`${session.device_name}, ${session.platform}, app ${session.app_version}${session.current ? ', this device' : ''}`}
    >
      <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
        <Icon
          name={session.platform === 'ios' ? 'logo-apple' : 'logo-android'}
          size={20}
          color="primary"
        />
      </View>
      <View style={styles.flex}>
        <Text variant="body" numberOfLines={1}>
          {session.device_name || 'Unknown device'}
        </Text>
        <Text
          variant="footnote"
          color={session.current ? 'success' : 'textSecondary'}
          numberOfLines={1}
        >
          {session.current
            ? 'This device'
            : `Active ${formatListTimestamp(session.last_active_at)}`}{' '}
          · v{session.app_version}
          {session.ip_country ? ` · ${session.ip_country}` : ''}
        </Text>
      </View>
      {!session.current && onRevoke ? (
        <IconButton
          icon="close-circle-outline"
          color="danger"
          accessibilityLabel={`Sign out ${session.device_name}`}
          onPress={() => onRevoke(session)}
        />
      ) : null}
    </Animated.View>
  );
}

export function SessionsScreen() {
  const { spacing, layout } = useTheme();
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [revokingOthers, setRevokingOthers] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSessions(await authApi.sessions());
    } catch (e) {
      setError(describeError(e));
    }
  }, []);

  useEffect(() => {
    authApi
      .sessions()
      .then(setSessions)
      .catch((e: unknown) => setError(describeError(e)));
  }, []);

  const revoke = (session: Session) => {
    Alert.alert('Sign out this device?', `${session.device_name} will be signed out of Najik.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          try {
            await authApi.revokeSession(session.id);
            haptics.success();
            setSessions((list) => list?.filter((s) => s.id !== session.id) ?? null);
          } catch (e) {
            toast.error("Couldn't sign out device", describeError(e));
          }
        },
      },
    ]);
  };

  const revokeOthers = () => {
    Alert.alert('Sign out all other devices?', 'Only this device will stay signed in.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out others',
        style: 'destructive',
        onPress: async () => {
          setRevokingOthers(true);
          try {
            await authApi.revokeOtherSessions();
            haptics.success();
            setSessions((list) => list?.filter((s) => s.current) ?? null);
          } catch (e) {
            toast.error("Couldn't sign out other devices", describeError(e));
          } finally {
            setRevokingOthers(false);
          }
        },
      },
    ]);
  };

  if (error && !sessions) {
    return (
      <EmptyState
        icon="cloud-offline-outline"
        title="Couldn't load devices"
        message={error}
        actionLabel="Try again"
        onAction={() => void load()}
      />
    );
  }

  const current = sessions?.filter((s) => s.current) ?? [];
  const others = sessions?.filter((s) => !s.current) ?? [];

  return (
    <ScrollView
      contentContainerStyle={{
        padding: spacing.lg,
        paddingBottom: insets.bottom + spacing.xxl,
        gap: spacing.xl,
        width: '100%',
        maxWidth: layout.maxContentWidth,
        alignSelf: 'center',
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      {!sessions ? (
        <View style={{ gap: spacing.md }}>
          <Skeleton height={64} radius={16} />
          <Skeleton height={64} radius={16} />
        </View>
      ) : (
        <>
          <ListSection title="This device">
            {current.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </ListSection>
          <ListSection
            title="Other devices"
            footer={others.length === 0 ? 'No other devices are signed in.' : undefined}
          >
            {others.map((s) => (
              <SessionRow key={s.id} session={s} onRevoke={revoke} />
            ))}
          </ListSection>
          {others.length > 0 ? (
            <Button
              title="Sign out all other devices"
              variant="danger"
              loading={revokingOthers}
              onPress={revokeOthers}
            />
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
