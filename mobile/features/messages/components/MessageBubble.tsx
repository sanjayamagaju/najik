import { LinearGradient } from 'expo-linear-gradient';
import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/useTheme';
import { isLocalMessage } from '@/store/messagesModel';
import type { CallMedia, CallMessageMeta, MessageStatus } from '@/types/protocol';
import { formatDuration, formatTime } from '@/utils/date';
import { countEmojiOnly } from '@/utils/emoji';

import type { MessageItem } from '../model/threadItems';

import { STATUS_LABEL, StatusTicks } from './StatusTicks';

export interface MessageBubbleProps {
  item: MessageItem;
  status: MessageStatus | null;
  peerName: string;
  /** Animate in (only for messages that arrive while the thread is open). */
  animateIn?: boolean;
  onRetry?: (clientId: string) => void;
  onLongPress?: (item: MessageItem) => void;
  /** Call-log bubbles: tap to call back with the same media. */
  onCallBack?: (media: CallMedia) => void;
}

const JUMBO_SIZES = [0, 48, 40, 34];

function MetaRow({
  time,
  status,
  color,
}: {
  time: string;
  status: MessageStatus | null;
  color: string;
}) {
  return (
    <View style={styles.meta}>
      <Text variant="micro" tint={color} maxFontSizeMultiplier={1.2}>
        {time}
      </Text>
      {status ? <StatusTicks status={status} baseColor={color} /> : null}
    </View>
  );
}

function callSummary(
  meta: Partial<CallMessageMeta>,
  isMine: boolean,
): { label: string; missed: boolean } {
  const media = meta.media === 'video' ? 'video' : 'voice';
  switch (meta.outcome) {
    case 'completed':
      return {
        label: `${media === 'video' ? 'Video' : 'Voice'} call${meta.duration_sec ? ` · ${formatDuration(meta.duration_sec)}` : ''}`,
        missed: false,
      };
    case 'missed':
      return {
        label: isMine ? `No answer · ${media} call` : `Missed ${media} call`,
        missed: !isMine,
      };
    case 'declined':
      return {
        label: isMine ? `Declined ${media} call` : `You declined a ${media} call`,
        missed: false,
      };
    case 'busy':
      return { label: `${media === 'video' ? 'Video' : 'Voice'} call · busy`, missed: !isMine };
    case 'cancelled':
      return {
        label: isMine ? `Cancelled ${media} call` : `Missed ${media} call`,
        missed: !isMine,
      };
    default:
      return { label: `${media === 'video' ? 'Video' : 'Voice'} call failed`, missed: false };
  }
}

export const MessageBubble = memo(function MessageBubble({
  item,
  status,
  peerName,
  animateIn = false,
  onRetry,
  onLongPress,
  onCallBack,
}: MessageBubbleProps) {
  const { colors, gradients, radii, spacing, layout } = useTheme();
  const reduceMotion = useReducedMotion();
  const { message, isMine, position } = item;
  const time = formatTime(message.created_at);
  const failed = isLocalMessage(message) && message.state === 'failed';
  const groupedTop = position === 'middle' || position === 'last';
  const tight = radii.bubbleTail;
  const corner = {
    borderTopLeftRadius: !isMine && groupedTop ? tight : radii.bubble,
    borderTopRightRadius: isMine && groupedTop ? tight : radii.bubble,
    borderBottomLeftRadius: !isMine ? tight : radii.bubble,
    borderBottomRightRadius: isMine ? tight : radii.bubble,
  };
  const entering = animateIn
    ? reduceMotion
      ? FadeIn.duration(150)
      : FadeInDown.springify().damping(18).stiffness(220)
    : undefined;
  const spacingBottom = position === 'last' || position === 'single' ? spacing.sm : spacing.xxs;
  const statusLabel = status ? STATUS_LABEL[status] : '';

  let content: ReactNode;
  let a11y: string;
  let callBack: (() => void) | undefined;

  if (message.kind === 'ping') {
    a11y = `${isMine ? `You pinged ${peerName}` : `${peerName} pinged you`}, ${time}${statusLabel ? `, ${statusLabel}` : ''}`;
    content = (
      <LinearGradient
        colors={gradients.ping}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.ping,
          {
            borderRadius: radii.lg,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            gap: spacing.md,
          },
        ]}
      >
        <View style={styles.pingIcon}>
          <Icon name="radio" size={20} tint="#FFFFFF" />
        </View>
        <View style={{ gap: 2 }}>
          <Text variant="bodyStrong" tint="#FFFFFF">
            {isMine ? 'You sent a Ping' : `${peerName} pinged you`}
          </Text>
          <MetaRow time={time} status={status} color="rgba(255,255,255,0.8)" />
        </View>
      </LinearGradient>
    );
  } else if (message.kind === 'call') {
    const meta = (message as { meta?: Partial<CallMessageMeta> }).meta ?? {};
    const { label, missed } = callSummary(meta, isMine);
    a11y = `${label}, ${time}`;
    if (onCallBack) {
      const media: CallMedia = meta.media === 'video' ? 'video' : 'audio';
      callBack = () => onCallBack(media);
    }
    content = (
      <View
        style={[
          styles.call,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.lg,
            padding: spacing.md,
            gap: spacing.md,
          },
        ]}
      >
        <View
          style={[
            styles.callIcon,
            { backgroundColor: missed ? colors.dangerSoft : colors.primarySoft },
          ]}
        >
          <Icon
            name={meta.media === 'video' ? 'videocam' : missed ? 'call-outline' : 'call'}
            size={18}
            tint={missed ? colors.danger : colors.primary}
          />
        </View>
        <View style={{ gap: 2 }}>
          <Text variant="subhead" tint={missed ? colors.danger : colors.text}>
            {label}
          </Text>
          <Text variant="micro" color="textTertiary">
            {time}
          </Text>
        </View>
      </View>
    );
  } else {
    const emojiCount = countEmojiOnly(message.body);
    const jumbo = emojiCount >= 1 && emojiCount <= 3;
    a11y = `${isMine ? 'You' : peerName}: ${message.body}, ${time}${statusLabel ? `, ${statusLabel}` : ''}`;
    if (jumbo) {
      const size = JUMBO_SIZES[emojiCount] ?? 34;
      content = (
        <View style={{ alignItems: isMine ? 'flex-end' : 'flex-start' }}>
          <Text
            style={{ fontSize: size, lineHeight: Math.round(size * 1.2) }}
            maxFontSizeMultiplier={1.2}
            testID="jumbo-emoji"
          >
            {message.body}
          </Text>
          <MetaRow time={time} status={status} color={colors.textTertiary} />
        </View>
      );
    } else {
      const textColor = isMine ? colors.bubbleOutgoingText : colors.bubbleIncomingText;
      const metaColor = isMine ? colors.bubbleOutgoingMeta : colors.bubbleIncomingMeta;
      const inner = (
        <>
          <Text variant="body" tint={textColor} selectable={false}>
            {message.body}
          </Text>
          <MetaRow time={time} status={status} color={metaColor} />
        </>
      );
      const pad = {
        paddingHorizontal: spacing.md + 2,
        paddingTop: spacing.sm,
        paddingBottom: spacing.xs + 2,
      };
      content = isMine ? (
        <LinearGradient
          colors={gradients.brand}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[corner, pad, failed && { opacity: 0.6 }]}
        >
          {inner}
        </LinearGradient>
      ) : (
        <View style={[corner, pad, { backgroundColor: colors.bubbleIncoming }]}>{inner}</View>
      );
    }
  }

  return (
    <Animated.View
      entering={entering}
      style={[
        styles.row,
        {
          justifyContent: isMine ? 'flex-end' : 'flex-start',
          marginBottom: spacingBottom,
          paddingHorizontal: spacing.md,
        },
      ]}
    >
      <View
        style={{
          maxWidth: `${layout.maxBubbleWidthRatio * 100}%`,
          alignItems: isMine ? 'flex-end' : 'flex-start',
        }}
      >
        <PressableScale
          pressedScale={0.98}
          delayLongPress={300}
          onLongPress={onLongPress ? () => onLongPress(item) : undefined}
          onPress={failed && onRetry ? () => onRetry(message.client_id) : callBack}
          accessibilityRole={failed || callBack ? 'button' : 'text'}
          accessibilityLabel={a11y}
          accessibilityHint={
            failed
              ? 'Double tap to retry sending'
              : callBack
                ? 'Double tap to call back'
                : 'Long press for options'
          }
          testID={`bubble-${message.client_id}`}
        >
          {content}
        </PressableScale>
        {failed && onRetry ? (
          <Pressable
            onPress={() => onRetry(message.client_id)}
            accessibilityRole="button"
            accessibilityLabel="Not sent. Tap to retry"
            hitSlop={8}
            style={[styles.retry, { gap: spacing.xs, marginTop: spacing.xxs }]}
          >
            <Icon name="refresh" size={13} color="danger" />
            <Text variant="caption" color="danger">
              Not sent · Tap to retry
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  meta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 4, marginTop: 2 },
  ping: { flexDirection: 'row', alignItems: 'center' },
  pingIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  call: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  callIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retry: { flexDirection: 'row', alignItems: 'center' },
});
