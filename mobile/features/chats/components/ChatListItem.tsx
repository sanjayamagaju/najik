import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { Icon, type IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/Text';
import { StatusTicks } from '@/features/messages/components/StatusTicks';
import { useTheme } from '@/hooks/useTheme';
import { selectMyUserId, useAuthStore } from '@/store/authStore';
import { useConversationsStore } from '@/store/conversationsStore';
import { deriveStatus } from '@/store/messagesModel';
import { usePresenceStore } from '@/store/presenceStore';
import { useTypingStore } from '@/store/typingStore';
import type { Conversation, MessageStatus } from '@/types/protocol';
import { formatListTimestamp } from '@/utils/date';
import { oneLine } from '@/utils/text';

export interface ChatListRowProps {
  conversation: Conversation;
  myUserId: string | null;
  online: boolean;
  typing: boolean;
  onPress: (conversationId: string) => void;
}

interface Preview {
  icon?: IconName;
  text: string;
  status: MessageStatus | null;
  missed?: boolean;
}

export function previewFor(conversation: Conversation, myUserId: string | null): Preview {
  const m = conversation.last_message;
  if (!m) return { text: 'Say hi 👋', status: null };
  const mine = m.sender_id === myUserId;
  const status = mine && m.kind !== 'call' ? deriveStatus(m, conversation) : null;
  if (m.kind === 'ping')
    return { icon: 'radio', text: mine ? 'You sent a Ping' : 'Pinged you', status };
  if (m.kind === 'call') {
    const meta = m.meta as { media?: string; outcome?: string };
    const video = meta.media === 'video';
    const missed =
      !mine &&
      (meta.outcome === 'missed' || meta.outcome === 'cancelled' || meta.outcome === 'busy');
    return {
      icon: video ? 'videocam' : 'call',
      text: missed
        ? `Missed ${video ? 'video' : 'voice'} call`
        : `${video ? 'Video' : 'Voice'} call`,
      status: null,
      missed,
    };
  }
  return { text: oneLine(m.body), status };
}

/** Pure row (easy to test); `ChatListItem` connects it to the stores. */
export const ChatListRow = memo(function ChatListRow({
  conversation,
  myUserId,
  online,
  typing,
  onPress,
}: ChatListRowProps) {
  const { colors, spacing } = useTheme();
  const { peer, unread_count: unread } = conversation;
  const preview = previewFor(conversation, myUserId);
  const timestamp = formatListTimestamp(
    conversation.last_message?.created_at ?? conversation.updated_at,
  );
  const a11y = [
    peer.display_name,
    online ? 'online' : null,
    typing ? 'typing' : preview.text,
    unread > 0 ? `${unread} unread` : null,
    timestamp,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <PressableScale
      pressedScale={0.985}
      onPress={() => onPress(conversation.id)}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint="Opens the chat"
      testID={`chat-row-${conversation.id}`}
      style={[
        styles.row,
        { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
      ]}
    >
      <Avatar name={peer.display_name} color={peer.avatar_color} size={54} online={online} />
      <View style={styles.body}>
        <View style={styles.line}>
          <Text variant="headline" numberOfLines={1} style={styles.name}>
            {peer.display_name}
          </Text>
          <Text variant="caption" color={unread > 0 ? 'primary' : 'textTertiary'}>
            {timestamp}
          </Text>
        </View>
        <View style={[styles.line, { gap: spacing.sm }]}>
          <View style={[styles.preview, { gap: spacing.xs }]}>
            {typing ? (
              <Text variant="callout" color="primary" numberOfLines={1}>
                typing…
              </Text>
            ) : (
              <>
                {preview.status ? (
                  <StatusTicks status={preview.status} baseColor={colors.textTertiary} />
                ) : null}
                {preview.icon ? (
                  <Icon
                    name={preview.icon}
                    size={15}
                    tint={
                      preview.missed
                        ? colors.danger
                        : preview.icon === 'radio'
                          ? colors.accent
                          : colors.textSecondary
                    }
                  />
                ) : null}
                <Text
                  variant="callout"
                  numberOfLines={1}
                  style={styles.previewText}
                  tint={
                    preview.missed ? colors.danger : unread > 0 ? colors.text : colors.textSecondary
                  }
                >
                  {preview.text}
                </Text>
              </>
            )}
          </View>
          <Badge count={unread} />
        </View>
      </View>
    </PressableScale>
  );
});

export const ChatListItem = memo(function ChatListItem({
  conversationId,
  onPress,
}: {
  conversationId: string;
  onPress: (conversationId: string) => void;
}) {
  const conversation = useConversationsStore((s) => s.byId[conversationId]);
  const myUserId = useAuthStore(selectMyUserId);
  const online = usePresenceStore((s) =>
    conversation ? s.byUserId[conversation.peer.id]?.online === true : false,
  );
  const typing = useTypingStore((s) => s.byConversation[conversationId] === true);
  if (!conversation) return null;
  return (
    <ChatListRow
      conversation={conversation}
      myUserId={myUserId}
      online={online}
      typing={typing}
      onPress={onPress}
    />
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  body: { flex: 1, gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { flex: 1, marginRight: 8 },
  preview: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  previewText: { flexShrink: 1 },
});
