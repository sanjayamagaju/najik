import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/Text';
import { MAX_FONT_SCALE } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { routes } from '@/navigation/routes';
import { usersApi } from '@/services/api/endpoints';
import { ApiError, describeError, normalizeError } from '@/services/api/errors';
import { toast } from '@/store/uiStore';
import type { PublicUser } from '@/types/protocol';
import { haptics } from '@/utils/haptics';

import { startConversation } from '../services/chatsService';

const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'results'; users: PublicUser[] }
  | { kind: 'error'; message: string };

/** Debounced, cancellable user search (`GET /users/search`), then get-or-create the chat. */
export function NewChatScreen() {
  const { colors, spacing, radii, typography } = useTheme();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const [opening, setOpening] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = query.trim();
    abortRef.current?.abort();
    if (q.length < MIN_QUERY) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => {
      setState({ kind: 'loading' });
      usersApi
        .search(q, { signal: controller.signal, limit: 20 })
        .then((users) => {
          if (!controller.signal.aborted) setState({ kind: 'results', users });
        })
        .catch((error: unknown) => {
          const e = normalizeError(error);
          if (e.code === 'cancelled' || controller.signal.aborted) return;
          setState({ kind: 'error', message: describeError(e) });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const open = async (user: PublicUser) => {
    if (opening) return;
    haptics.selection();
    setOpening(user.id);
    try {
      const conversation = await startConversation(user.id);
      router.replace(routes.chat(conversation.id));
    } catch (error) {
      toast.error(
        "Couldn't open chat",
        describeError(error instanceof ApiError ? error : normalizeError(error)),
      );
    } finally {
      setOpening(null);
    }
  };

  const view: SearchState = query.trim().length < MIN_QUERY ? { kind: 'idle' } : state;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { padding: spacing.lg, gap: spacing.sm }]}>
        <View
          style={[
            styles.search,
            {
              backgroundColor: colors.inputBackground,
              borderRadius: radii.pill,
              paddingHorizontal: spacing.md,
              gap: spacing.sm,
            },
          ]}
        >
          <Icon name="search" size={18} color="textTertiary" />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="Search by username or name"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search people"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            selectionColor={colors.primary}
            style={[typography.body, styles.input, { color: colors.text }]}
            testID="user-search-input"
          />
          {query ? (
            <IconButton
              icon="close-circle"
              color="textTertiary"
              size={18}
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
            />
          ) : null}
        </View>
      </View>

      {view.kind === 'idle' ? (
        <View style={[styles.center, { padding: spacing.xxl, gap: spacing.sm }]}>
          <Icon name="people-outline" size={40} color="textTertiary" />
          <Text variant="callout" color="textSecondary" align="center">
            Type at least {MIN_QUERY} characters to find people on Najik.
          </Text>
        </View>
      ) : view.kind === 'loading' ? (
        <ActivityIndicator
          style={{ marginTop: spacing.xxl }}
          color={colors.primary}
          accessibilityLabel="Searching"
        />
      ) : view.kind === 'error' ? (
        <View style={[styles.center, { padding: spacing.xxl }]}>
          <Text variant="callout" color="danger" align="center" accessibilityRole="alert">
            {view.message}
          </Text>
        </View>
      ) : view.users.length === 0 ? (
        <View style={[styles.center, { padding: spacing.xxl }]}>
          <Text variant="callout" color="textSecondary" align="center">
            No one matches “{query.trim()}”.
          </Text>
        </View>
      ) : (
        <FlashList
          data={view.users}
          keyExtractor={(u) => u.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Animated.View entering={FadeIn.duration(160)}>
              <PressableScale
                pressedScale={0.985}
                onPress={() => void open(item)}
                accessibilityRole="button"
                accessibilityLabel={`${item.display_name}, @${item.username}`}
                accessibilityHint="Opens a chat"
                style={[
                  styles.row,
                  { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
                ]}
              >
                <Avatar name={item.display_name} color={item.avatar_color} size={46} />
                <View style={styles.flex}>
                  <Text variant="headline" numberOfLines={1}>
                    {item.display_name}
                  </Text>
                  <Text variant="footnote" color="textSecondary" numberOfLines={1}>
                    @{item.username}
                  </Text>
                </View>
                {opening === item.id ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Icon name="chatbubble-outline" size={20} color="primary" />
                )}
              </PressableScale>
            </Animated.View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {},
  search: { flexDirection: 'row', alignItems: 'center', minHeight: 46 },
  input: { flex: 1, paddingVertical: 10 },
  center: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
