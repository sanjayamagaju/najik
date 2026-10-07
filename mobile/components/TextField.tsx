import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { MAX_FONT_SCALE } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

import { IconButton } from './IconButton';
import { Text } from './Text';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  hint?: string;
  /** Adds a show/hide toggle for passwords. */
  secureToggle?: boolean;
}

/** Labeled input with animated focus ring and inline error. */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, secureToggle, secureTextEntry, onFocus, onBlur, testID, ...rest },
  ref,
) {
  const { colors, radii, spacing, typography, motion } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const borderColor = error ? colors.danger : focused ? colors.primary : colors.border;

  const ringStyle = useAnimatedStyle(() => ({
    borderColor: withTiming(borderColor, { duration: motion.duration.fast }),
  }));

  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="subhead" color="textSecondary" nativeID={`${testID ?? label}-label`}>
        {label}
      </Text>
      <Animated.View
        style={[
          styles.field,
          {
            backgroundColor: colors.inputBackground,
            borderRadius: radii.md,
            paddingHorizontal: spacing.lg,
          },
          ringStyle,
        ]}
      >
        <TextInput
          ref={ref}
          testID={testID}
          {...rest}
          accessibilityLabel={label}
          accessibilityLabelledBy={`${testID ?? label}-label`}
          accessibilityHint={error ?? hint}
          secureTextEntry={secureToggle ? hidden : secureTextEntry}
          placeholderTextColor={colors.textTertiary}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          selectionColor={colors.primary}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, typography.body, { color: colors.text }]}
        />
        {secureToggle ? (
          <IconButton
            icon={hidden ? 'eye-outline' : 'eye-off-outline'}
            color="textTertiary"
            size={20}
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            onPress={() => setHidden((h) => !h)}
          />
        ) : null}
      </Animated.View>
      {error ? (
        <Animated.View
          entering={FadeIn.duration(motion.duration.fast)}
          exiting={FadeOut.duration(motion.duration.fast)}
        >
          <Text
            variant="caption"
            color="danger"
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
          >
            {error}
          </Text>
        </Animated.View>
      ) : hint ? (
        <Text variant="caption" color="textTertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, minHeight: 52 },
  input: { flex: 1, paddingVertical: 12 },
});
