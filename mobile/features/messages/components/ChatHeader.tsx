import { router } from 'expo-router';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { IconButton } from '@/components/IconButton';
import { Text } from '@/components/Text';
import { presenceLabel, useNow, usePresence } from '@/features/presence/hooks';
import { useTheme } from '@/hooks/useTheme';
import { routes } from '@/navigation/routes';
import { useConnectionStore } from '@/store/connectionStore';
import { useTypingStore } from '@/store/typingStore';
import type { PublicUser } from '@/types/protocol';
import { haptics } from '@/utils/haptics';

export interface ChatHeaderProps {
  conversationId: string;
  peer: PublicUser;
}

/** Custom chat header: avatar + presence, typing / connection-aware subtitle, call buttons. */
export const ChatHeader = memo(function ChatHeader({ conversationId, peer }: ChatHeaderProps) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const presence = usePresence(peer.id);
  const typing = useTypingStore((s) => s.byConversation[conversationId] === true);
  const wsState = useConnectionStore((s) => s.wsState);
  const network = useConnectionStore((s) => s.networkAvailable);
  const now = useNow();

  let subtitle: string | null;
  let accent = false;
  if (!network || wsState === 'offline') subtitle = 'Waiting for network…';
  else if (wsState !== 'open') subtitle = 'Connecting…';
  else if (typing) {
    subtitle = 'typing…';
    accent = true;
  } else subtitle = presenceLabel(presence, now);

  const call = (media: 'audio' | 'video') => {
    haptics.light();
    router.push(routes.call(peer.id, media, conversationId));
  };

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + spacing.xs,
          paddingBottom: spacing.sm,
          paddingHorizontal: spacing.xs,
          backgroundColor: colors.background,
          borderBottomColor: colors.separator,
        },
      ]}
    >
      <IconButton
        icon="chevron-back"
        accessibilityLabel="Back"
        color="text"
        onPress={() => router.back()}
      />
      <View
        style={[styles.identity, { gap: spacing.md }]}
        accessible
        accessibilityRole="header"
        accessibilityLabel={`${peer.display_name}${subtitle ? `, ${subtitle}` : ''}`}
      >
        <Avatar
          name={peer.display_name}
          color={peer.avatar_color}
          size={40}
          online={presence?.online ?? false}
        />
        <View style={styles.text}>
          <Text variant="headline" numberOfLines={1}>
            {peer.display_name}
          </Text>
          {subtitle ? (
            <Animated.View
              key={subtitle}
              entering={FadeIn.duration(160)}
              exiting={FadeOut.duration(120)}
            >
              <Text
                variant="caption"
                color={
                  accent
                    ? 'primary'
                    : presence?.online && subtitle === 'Online'
                      ? 'success'
                      : 'textSecondary'
                }
                numberOfLines={1}
              >
                {subtitle}
              </Text>
            </Animated.View>
          ) : (
            <Text variant="caption" color="textTertiary" numberOfLines={1}>
              @{peer.username}
            </Text>
          )}
        </View>
      </View>
      <IconButton
        icon="call-outline"
        accessibilityLabel={`Voice call ${peer.display_name}`}
        onPress={() => call('audio')}
      />
      <IconButton
        icon="videocam-outline"
        accessibilityLabel={`Video call ${peer.display_name}`}
        onPress={() => call('video')}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1 },
});
