import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ConnectionBanner } from '@/components/ConnectionBanner';
import { Icon } from '@/components/Icon';
import { Sheet, SheetAction } from '@/components/Sheet';
import { Skeleton } from '@/components/Skeleton';
import { Text } from '@/components/Text';
import { PingButton } from '@/features/ping/components/PingButton';
import { useTheme } from '@/hooks/useTheme';
import { routes } from '@/navigation/routes';
import { conversationsApi } from '@/services/api/endpoints';
import { describeError } from '@/services/api/errors';
import { clearConversationNotifications } from '@/services/notifications';
import { selectMyUserId, useAuthStore } from '@/store/authStore';
import { useConversationsStore } from '@/store/conversationsStore';
import { deriveStatus, isLocalMessage } from '@/store/messagesModel';
import { useMessagesStore } from '@/store/messagesStore';
import { useTypingStore } from '@/store/typingStore';
import { toast, useUiStore } from '@/store/uiStore';
import type { CallMedia } from '@/types/protocol';
import { haptics } from '@/utils/haptics';

import { ChatHeader } from '../components/ChatHeader';
import { Composer, type ComposerHandle } from '../components/Composer';
import { DaySeparator } from '../components/DaySeparator';
import { EmojiPicker } from '../components/EmojiPicker';
import { MessageBubble } from '../components/MessageBubble';
import { NewMessagesPill } from '../components/NewMessagesPill';
import { TypingIndicator } from '../components/TypingIndicator';
import { buildThreadItems, type MessageItem, type ThreadItem } from '../model/threadItems';
import { loadOlder, openConversationHistory } from '../services/history';
import { reportRead } from '../services/receipts';
import { discardFailedMessage, retryFailedMessage, sendTextMessage } from '../services/send';
import { notifyTyping, stopTyping } from '../services/typingSender';

const SCROLLED_UP_THRESHOLD = 280;
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 60, minimumViewTime: 250 };
const DEFAULT_PANEL_HEIGHT = 300;

export function ChatScreen({ conversationId }: { conversationId: string }) {
  const conversation = useConversationsStore((s) => s.byId[conversationId]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Deep link / notification into a chat we don't have cached yet.
  const fetchConversation = useCallback(async () => {
    setLoadError(null);
    try {
      useConversationsStore.getState().upsert(await conversationsApi.get(conversationId));
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, [conversationId]);

  const missing = !conversation;
  useEffect(() => {
    if (!missing) return;
    conversationsApi
      .get(conversationId)
      .then((c) => useConversationsStore.getState().upsert(c))
      .catch((error: unknown) => setLoadError(describeError(error)));
  }, [missing, conversationId]);

  if (!conversation) {
    return <ChatPlaceholder error={loadError} onRetry={() => void fetchConversation()} />;
  }
  return <ChatThread conversationId={conversationId} />;
}

function ChatPlaceholder({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.flex,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + spacing.lg,
          padding: spacing.lg,
          gap: spacing.lg,
        },
      ]}
    >
      {error ? (
        <View style={[styles.center, { gap: spacing.md }]}>
          <Icon name="cloud-offline-outline" size={40} color="textTertiary" />
          <Text variant="callout" color="textSecondary" align="center">
            {error}
          </Text>
          <Button title="Try again" onPress={onRetry} size="md" />
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
            <Skeleton width={40} height={40} radius={20} />
            <Skeleton width={140} height={16} />
          </View>
          <Skeleton width="60%" height={40} radius={18} />
          <Skeleton width="45%" height={40} radius={18} style={{ alignSelf: 'flex-end' }} />
          <Skeleton width="70%" height={56} radius={18} />
        </>
      )}
    </View>
  );
}

function ChatThread({ conversationId }: { conversationId: string }) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const conversation = useConversationsStore((s) => s.byId[conversationId]);
  const convMessages = useMessagesStore((s) => s.byConversation[conversationId]);
  const myUserId = useAuthStore(selectMyUserId);
  const peerTyping = useTypingStore((s) => s.byConversation[conversationId] === true);
  const appActive = useUiStore((s) => s.appActive);

  const [initialLoading, setInitialLoading] = useState(
    () => !convMessages || convMessages.seqs.length === 0,
  );
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [scrolledUp, setScrolledUp] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const [actionItem, setActionItem] = useState<MessageItem | null>(null);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);

  const listRef = useRef<FlatList<ThreadItem>>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const [mountedAt] = useState(() => Date.now());
  const focused = useRef(false);
  const maxVisiblePeerSeq = useRef(0);

  const items = useMemo(() => buildThreadItems(convMessages, myUserId), [convMessages, myUserId]);
  const peer = conversation?.peer;

  // ── Focus lifecycle: active chat (notification suppression), clear its notifications ──
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      useUiStore.getState().setActiveConversation(conversationId);
      void clearConversationNotifications(conversationId);
      return () => {
        focused.current = false;
        if (useUiStore.getState().activeConversationId === conversationId) {
          useUiStore.getState().setActiveConversation(null);
        }
        stopTyping(conversationId);
      };
    }, [conversationId]),
  );

  // ── History: sync from cache or load the latest page ──
  useEffect(() => {
    let cancelled = false;
    openConversationHistory(conversationId)
      .catch((error: unknown) => {
        if (!cancelled) toast.error("Couldn't load messages", describeError(error));
      })
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // ── Read receipts: only for messages on screen while the app is active ──
  const sendReadIfVisible = useCallback(() => {
    if (!focused.current || !useUiStore.getState().appActive) return;
    if (maxVisiblePeerSeq.current > 0) reportRead(conversationId, maxVisiblePeerSeq.current);
  }, [conversationId]);

  const sendReadRef = useRef(sendReadIfVisible);
  useEffect(() => {
    sendReadRef.current = sendReadIfVisible;
  }, [sendReadIfVisible]);

  // Must be referentially stable for FlatList.
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<ThreadItem>[] }) => {
      let max = 0;
      for (const token of viewableItems) {
        const item = token.item;
        if (item?.type === 'message' && !item.isMine && !isLocalMessage(item.message)) {
          max = Math.max(max, item.message.seq);
        }
      }
      if (max > maxVisiblePeerSeq.current) {
        maxVisiblePeerSeq.current = max;
        sendReadRef.current();
      }
    },
    [],
  );

  useEffect(() => {
    if (appActive) sendReadIfVisible();
  }, [appActive, sendReadIfVisible]);

  // ── "N new messages" pill while scrolled up ──
  const newestPeerSeq = useRef(0);
  useEffect(() => {
    const newest = items.find(
      (i): i is MessageItem => i.type === 'message' && !isLocalMessage(i.message),
    );
    const seq = newest && !isLocalMessage(newest.message) ? newest.message.seq : 0;
    if (
      newest &&
      !newest.isMine &&
      seq > newestPeerSeq.current &&
      newestPeerSeq.current > 0 &&
      scrolledUp
    ) {
      setUnseenCount((c) => c + 1);
    }
    if (seq > newestPeerSeq.current) newestPeerSeq.current = seq;
  }, [items, scrolledUp]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const up = e.nativeEvent.contentOffset.y > SCROLLED_UP_THRESHOLD;
    if (!up) setUnseenCount(0);
    setScrolledUp(up);
  }, []);

  const jumpToLatest = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setUnseenCount(0);
  }, []);

  // ── Older history ──
  const onEndReached = useCallback(() => {
    if (loadingOlder || !convMessages?.hasMoreOlder || convMessages.seqs.length === 0) return;
    setLoadingOlder(true);
    loadOlder(conversationId)
      .catch((error: unknown) => toast.error("Couldn't load older messages", describeError(error)))
      .finally(() => setLoadingOlder(false));
  }, [conversationId, convMessages, loadingOlder]);

  // ── Sending ──
  const onSend = useCallback(
    (text: string) => {
      const id = sendTextMessage(conversationId, text);
      if (!id) return false;
      stopTyping(conversationId);
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      return true;
    },
    [conversationId],
  );
  const onTyping = useCallback(() => notifyTyping(conversationId), [conversationId]);
  const onRetry = useCallback((clientId: string) => retryFailedMessage(clientId), []);
  const onLongPress = useCallback((item: MessageItem) => setActionItem(item), []);
  const peerId = peer?.id;
  const onCallBack = useCallback(
    (media: CallMedia) => {
      if (!peerId) return;
      haptics.light();
      router.push(routes.call(peerId, media, conversationId));
    },
    [peerId, conversationId],
  );

  // ── Keyboard / emoji panel (UI-thread keyboard tracking, edge-to-edge safe) ──
  const keyboard = useAnimatedKeyboard();
  const bottomInset = insets.bottom;
  const keyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: emojiOpen ? 0 : Math.max(keyboard.height.get(), bottomInset),
  }));
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', (e) => {
      setPanelHeight(Math.max(DEFAULT_PANEL_HEIGHT - 40, e.endCoordinates.height - bottomInset));
      setEmojiOpen(false);
    });
    return () => sub.remove();
  }, [bottomInset]);

  const toggleEmoji = useCallback(() => {
    setEmojiOpen((open) => {
      if (!open) Keyboard.dismiss();
      return !open;
    });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ThreadItem }) => {
      if (item.type === 'day') return <DaySeparator at={item.at} />;
      const message = item.message;
      const status =
        item.isMine && message.kind !== 'call' ? deriveStatus(message, conversation) : null;
      const animateIn =
        isLocalMessage(message) || Date.parse(message.created_at) > mountedAt - 2000;
      return (
        <MessageBubble
          item={item}
          status={status}
          peerName={peer?.display_name ?? ''}
          animateIn={animateIn}
          onRetry={onRetry}
          onLongPress={onLongPress}
          onCallBack={message.kind === 'call' ? onCallBack : undefined}
        />
      );
    },
    [conversation, peer?.display_name, onRetry, onLongPress, onCallBack, mountedAt],
  );

  if (!conversation || !peer) return null;

  const actionMessage = actionItem?.message;
  const actionFailed =
    !!actionMessage && isLocalMessage(actionMessage) && actionMessage.state === 'failed';

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ChatHeader conversationId={conversationId} peer={peer} />
      <ConnectionBanner />
      <Animated.View style={[styles.flex, keyboardStyle]}>
        <View style={styles.flex}>
          {initialLoading && items.length === 0 ? (
            <View
              style={[
                styles.flex,
                { padding: spacing.lg, gap: spacing.md, justifyContent: 'flex-end' },
              ]}
            >
              <Skeleton width="55%" height={38} radius={18} />
              <Skeleton width="40%" height={38} radius={18} style={{ alignSelf: 'flex-end' }} />
              <Skeleton width="65%" height={54} radius={18} />
              <Skeleton width="35%" height={38} radius={18} style={{ alignSelf: 'flex-end' }} />
            </View>
          ) : items.length === 0 ? (
            <View style={[styles.center, styles.flex, { gap: spacing.sm, padding: spacing.xxl }]}>
              <Text variant="headline" align="center">
                Say hi to {peer.display_name} 👋
              </Text>
              <Text variant="callout" color="textSecondary" align="center">
                Send a message, or tap the Ping button to make their phone buzz.
              </Text>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              inverted
              data={items}
              keyExtractor={(item) => item.key}
              renderItem={renderItem}
              onEndReached={onEndReached}
              onEndReachedThreshold={0.4}
              onScroll={onScroll}
              scrollEventThrottle={64}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={VIEWABILITY_CONFIG}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
              initialNumToRender={20}
              maxToRenderPerBatch={16}
              windowSize={11}
              contentContainerStyle={{ paddingTop: spacing.sm }}
              ListHeaderComponent={peerTyping ? <TypingIndicator /> : null}
              ListFooterComponent={
                loadingOlder ? (
                  <ActivityIndicator
                    style={{ marginVertical: spacing.lg }}
                    color={colors.primary}
                  />
                ) : convMessages && !convMessages.hasMoreOlder ? (
                  <View style={[styles.center, { paddingVertical: spacing.xl, gap: spacing.xs }]}>
                    <Icon name="lock-closed-outline" size={14} color="textTertiary" />
                    <Text variant="caption" color="textTertiary" align="center">
                      This is the beginning of your chat with {peer.display_name}
                    </Text>
                  </View>
                ) : null
              }
            />
          )}
          {scrolledUp ? <NewMessagesPill count={unseenCount} onPress={jumpToLatest} /> : null}
        </View>
        <View
          style={{
            backgroundColor: colors.background,
            borderTopColor: colors.separator,
            borderTopWidth: StyleSheet.hairlineWidth,
          }}
        >
          <Composer
            inputRef={composerRef}
            onSend={onSend}
            onTyping={onTyping}
            onFocus={() => setEmojiOpen(false)}
            emojiOpen={emojiOpen}
            onToggleEmoji={toggleEmoji}
            emptyAction={<PingButton conversationId={conversationId} />}
          />
          {emojiOpen ? (
            <View style={{ paddingBottom: bottomInset }}>
              <EmojiPicker
                height={panelHeight}
                onSelect={(emoji) => composerRef.current?.insert(emoji)}
              />
            </View>
          ) : null}
        </View>
      </Animated.View>

      <Sheet visible={actionItem !== null} onClose={() => setActionItem(null)}>
        {actionMessage && actionMessage.kind === 'text' ? (
          <SheetAction
            icon="copy-outline"
            label="Copy text"
            onPress={() => {
              void Clipboard.setStringAsync(actionMessage.body);
              setActionItem(null);
              toast.success('Copied');
            }}
          />
        ) : null}
        {actionFailed ? (
          <>
            <SheetAction
              icon="refresh"
              label="Retry sending"
              onPress={() => {
                retryFailedMessage(actionMessage.client_id);
                setActionItem(null);
              }}
            />
            <SheetAction
              icon="trash-outline"
              label="Delete unsent message"
              destructive
              onPress={() => {
                discardFailedMessage(conversationId, actionMessage.client_id);
                setActionItem(null);
              }}
            />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
