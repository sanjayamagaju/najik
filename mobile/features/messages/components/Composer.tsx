import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode, type RefObject, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  useReducedMotion,
  ZoomIn,
  ZoomOut,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { PressableScale } from '@/components/PressableScale';
import { MAX_FONT_SCALE } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { haptics } from '@/utils/haptics';

import { MAX_MESSAGE_LENGTH } from '../services/send';

export interface ComposerProps {
  /** Returns true if the message was accepted (the input is then cleared). */
  onSend: (text: string) => boolean;
  onTyping?: () => void;
  onFocus?: () => void;
  emojiOpen: boolean;
  onToggleEmoji: () => void;
  /** Rendered in place of the send button while the input is empty (the Ping button). */
  emptyAction?: ReactNode;
  /** Exposes `insert` so the emoji picker can append at the cursor. */
  inputRef?: RefObject<ComposerHandle | null>;
}

export interface ComposerHandle {
  insert: (text: string) => void;
  focus: () => void;
}

const MAX_INPUT_HEIGHT = 140;

/** Auto-growing composer. Empty → Ping button; with text → animated Send button. */
export function Composer({
  onSend,
  onTyping,
  onFocus,
  emojiOpen,
  onToggleEmoji,
  emptyAction,
  inputRef,
}: ComposerProps) {
  const { colors, gradients, spacing, radii, typography } = useTheme();
  const reduceMotion = useReducedMotion();
  const [text, setText] = useState('');
  const selection = useRef({ start: 0, end: 0 });
  const input = useRef<TextInput>(null);
  const hasText = text.trim().length > 0;

  useImperativeHandle(
    inputRef,
    () => ({
      insert: (value: string) => {
        setText((current) => {
          const start = Math.min(selection.current.start, current.length);
          const end = Math.min(selection.current.end, current.length);
          const caret = start + value.length;
          selection.current = { start: caret, end: caret };
          return (current.slice(0, start) + value + current.slice(end)).slice(
            0,
            MAX_MESSAGE_LENGTH,
          );
        });
        onTyping?.();
      },
      focus: () => input.current?.focus(),
    }),
    [onTyping],
  );

  const send = () => {
    if (!hasText) return;
    if (onSend(text)) {
      haptics.light();
      setText('');
      selection.current = { start: 0, end: 0 };
    }
  };

  const swapIn = reduceMotion
    ? FadeIn.duration(120)
    : ZoomIn.springify().damping(14).stiffness(280);
  const swapOut = reduceMotion ? FadeOut.duration(100) : ZoomOut.duration(120);

  return (
    <View
      style={[
        styles.root,
        { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.xs },
      ]}
    >
      <View
        style={[
          styles.field,
          {
            backgroundColor: colors.inputBackground,
            borderRadius: radii.xl,
            paddingLeft: spacing.xs,
            paddingRight: spacing.md,
          },
        ]}
      >
        <IconButton
          icon={emojiOpen ? 'chatbox-ellipses-outline' : 'happy-outline'}
          color="textSecondary"
          accessibilityLabel={emojiOpen ? 'Show keyboard' : 'Show emoji'}
          onPress={() => {
            haptics.selection();
            if (emojiOpen) input.current?.focus();
            onToggleEmoji();
          }}
          testID="emoji-toggle"
        />
        <TextInput
          ref={input}
          testID="composer-input"
          value={text}
          onChangeText={(value) => {
            setText(value);
            if (value.trim().length > 0) onTyping?.();
          }}
          onSelectionChange={(e) => {
            selection.current = e.nativeEvent.selection;
          }}
          onFocus={onFocus}
          placeholder="Message"
          placeholderTextColor={colors.textTertiary}
          multiline
          maxLength={MAX_MESSAGE_LENGTH}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityLabel="Message"
          selectionColor={colors.primary}
          style={[
            typography.body,
            styles.input,
            { color: colors.text, maxHeight: MAX_INPUT_HEIGHT },
          ]}
          textAlignVertical="center"
        />
      </View>
      <View style={styles.action}>
        {hasText ? (
          <Animated.View key="send" entering={swapIn} exiting={swapOut}>
            <PressableScale
              testID="send-button"
              onPress={send}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              pressedScale={0.88}
              style={styles.sendWrap}
            >
              <LinearGradient
                colors={gradients.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.send}
              >
                <Icon name="arrow-up" size={22} tint="#FFFFFF" />
              </LinearGradient>
            </PressableScale>
          </Animated.View>
        ) : (
          <Animated.View key="empty" entering={swapIn} exiting={swapOut}>
            {emptyAction}
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'flex-end' },
  field: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', minHeight: 44 },
  input: { flex: 1, paddingTop: 11, paddingBottom: 11 },
  action: { minWidth: 52, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  sendWrap: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden' },
  send: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
