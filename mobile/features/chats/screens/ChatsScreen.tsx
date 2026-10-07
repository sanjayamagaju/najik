import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';

import { ConnectionBanner } from '@/components/ConnectionBanner';
import { EmptyState } from '@/components/EmptyState';
import { IconButton } from '@/components/IconButton';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/useTheme';
import { routes } from '@/navigation/routes';
import { describeError } from '@/services/api/errors';
import { selectSortedConversationIds, useConversationsStore } from '@/store/conversationsStore';
import { toast } from '@/store/uiStore';
import { haptics } from '@/utils/haptics';

import { ChatListItem } from '../components/ChatListItem';
import { ChatsSkeleton } from '../components/ChatsSkeleton';
import { useNotificationPrompt } from '../hooks/useNotificationPrompt';
import { loadMoreConversations, refreshConversations } from '../services/chatsService';

export function ChatsScreen() {
  const { colors, spacing, layout } = useTheme();
  const insets = useSafeAreaInsets();
  const ids = useConversationsStore(useShallow(selectSortedConversationIds));
  const loaded = useConversationsStore((s) => s.loaded);
  const hasMore = useConversationsStore((s) => s.nextCursor !== null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialError, setInitialError] = useState<string | null>(null);

  useNotificationPrompt(loaded);

  const load = useCallback(async () => {
    setInitialError(null);
    try {
      await refreshConversations();
    } catch (error) {
      setInitialError(describeError(error));
    }
  }, []);

  useEffect(() => {
    // The socket's resync also loads this; fetching here keeps the list fast if the socket is slow.
    if (useConversationsStore.getState().loaded) return;
    refreshConversations().catch((error: unknown) => setInitialError(describeError(error)));
  }, []);

  const onRefresh = useCallback(async () => {
    haptics.light();
    setRefreshing(true);
    try {
      await refreshConversations();
    } catch (error) {
      toast.error("Couldn't refresh", describeError(error));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const onEndReached = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    loadMoreConversations()
      .catch((error: unknown) => toast.error("Couldn't load more chats", describeError(error)))
      .finally(() => setLoadingMore(false));
  }, [hasMore, loadingMore]);

  const openChat = useCallback((id: string) => {
    haptics.selection();
    router.push(routes.chat(id));
  }, []);

  const newChat = () => {
    haptics.light();
    router.push(routes.newChat);
  };

  let body;
  if (ids.length === 0 && !loaded) {
    body = initialError ? (
      <EmptyState
        icon="cloud-offline-outline"
        title="Can't reach Najik"
        message={initialError}
        actionLabel="Try again"
        onAction={() => void load()}
      />
    ) : (
      <ChatsSkeleton />
    );
  } else if (ids.length === 0) {
    body = (
      <EmptyState
        icon="chatbubbles-outline"
        title="No chats yet"
        message="Find a friend by their username and say hello — or send them a Ping."
        actionLabel="Find people"
        onAction={newChat}
      />
    );
  } else {
    body = (
      <FlashList
        data={ids}
        keyExtractor={(id) => id}
        renderItem={({ item }) => <ChatListItem conversationId={item} onPress={openChat} />}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator style={{ margin: spacing.lg }} color={colors.primary} />
          ) : null
        }
        ItemSeparatorComponent={() => (
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              marginLeft: 86,
              backgroundColor: colors.separator,
            }}
          />
        )}
      />
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + spacing.sm,
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.sm,
          },
        ]}
      >
        <Text variant="display" accessibilityRole="header">
          Chats
        </Text>
        <IconButton
          icon="create-outline"
          variant="tonal"
          accessibilityLabel="New chat"
          onPress={newChat}
          testID="new-chat"
        />
      </View>
      <ConnectionBanner />
      <View
        style={[
          styles.flex,
          { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
        ]}
      >
        {body}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
