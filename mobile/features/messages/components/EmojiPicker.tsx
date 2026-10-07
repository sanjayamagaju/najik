import { FlashList } from '@shopify/flash-list';
import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/Icon';
import { Text } from '@/components/Text';
import { MAX_FONT_SCALE } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { haptics } from '@/utils/haptics';

import { EMOJI_CATEGORIES } from '../emoji/emojiData';
import { useRecentEmoji } from '../emoji/recentEmoji';

export interface EmojiPickerProps {
  height: number;
  onSelect: (emoji: string) => void;
}

const CELL = 44;

interface Tab {
  key: string;
  title: string;
  icon: IconName;
}

const TABS: Tab[] = [
  { key: 'recent', title: 'Recently used', icon: 'time-outline' },
  ...EMOJI_CATEGORIES.map((c) => ({ key: c.key, title: c.title, icon: c.icon })),
];

const EmojiCell = memo(function EmojiCell({
  emoji,
  name,
  onPress,
}: {
  emoji: string;
  name: string;
  onPress: (e: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(emoji)}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={({ pressed }) => [styles.cell, pressed && { transform: [{ scale: 1.25 }] }]}
    >
      <Text style={styles.emoji} maxFontSizeMultiplier={1}>
        {emoji}
      </Text>
    </Pressable>
  );
});

/** Offline emoji picker using the platform's native emoji font (no image sprites). */
export function EmojiPicker({ height, onSelect }: EmojiPickerProps) {
  const { colors, spacing, radii, typography } = useTheme();
  const reduceMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const recent = useRecentEmoji((s) => s.recent);
  const loadRecent = useRecentEmoji((s) => s.load);
  const rememberEmoji = useRecentEmoji((s) => s.remember);
  const [tab, setTab] = useState<string>(
    recent.length > 0 ? 'recent' : (EMOJI_CATEGORIES[0]?.key ?? 'smileys'),
  );
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const columns = Math.max(6, Math.floor((width - spacing.sm * 2) / CELL));

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const data = useMemo<(readonly [string, string])[]>(() => {
    if (deferredQuery.length >= 2) {
      const out: (readonly [string, string])[] = [];
      for (const c of EMOJI_CATEGORIES)
        for (const e of c.emojis) if (e[1].includes(deferredQuery)) out.push(e);
      return out.slice(0, 160);
    }
    if (tab === 'recent') return recent.map((e) => [e, 'recent emoji'] as const);
    return [...(EMOJI_CATEGORIES.find((c) => c.key === tab)?.emojis ?? [])];
  }, [deferredQuery, tab, recent]);

  const select = (emoji: string) => {
    haptics.selection();
    rememberEmoji(emoji);
    onSelect(emoji);
  };

  return (
    <Animated.View
      entering={reduceMotion ? FadeIn : FadeInDown.duration(220)}
      style={[
        styles.root,
        { height, backgroundColor: colors.surface, borderTopColor: colors.border },
      ]}
    >
      <View
        style={[
          styles.search,
          {
            margin: spacing.sm,
            backgroundColor: colors.inputBackground,
            borderRadius: radii.pill,
            paddingHorizontal: spacing.md,
            gap: spacing.sm,
          },
        ]}
      >
        <Icon name="search" size={16} color="textTertiary" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search emoji"
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel="Search emoji"
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[typography.callout, styles.searchInput, { color: colors.text }]}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>
      {deferredQuery.length < 2 ? (
        <View style={[styles.tabs, { paddingHorizontal: spacing.sm }]} accessibilityRole="tablist">
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <Pressable
                key={t.key}
                onPress={() => {
                  haptics.selection();
                  setTab(t.key);
                }}
                accessibilityRole="tab"
                accessibilityLabel={t.title}
                accessibilityState={{ selected: active }}
                style={[
                  styles.tab,
                  {
                    borderRadius: radii.sm,
                    backgroundColor: active ? colors.primarySoft : 'transparent',
                  },
                ]}
              >
                <Icon
                  name={t.icon}
                  size={18}
                  tint={active ? colors.primary : colors.textTertiary}
                />
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {data.length === 0 ? (
        <View style={styles.empty}>
          <Text variant="footnote" color="textTertiary">
            {deferredQuery.length >= 2 ? 'No emoji found' : 'Emoji you use will show up here'}
          </Text>
        </View>
      ) : (
        <FlashList
          key={`${columns}-${tab}-${deferredQuery.length >= 2 ? 'q' : 't'}`}
          data={data}
          numColumns={columns}
          keyboardShouldPersistTaps="always"
          keyExtractor={(item, index) => `${item[0]}-${index}`}
          contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.md }}
          renderItem={({ item }) => <EmojiCell emoji={item[0]} name={item[1]} onPress={select} />}
        />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { borderTopWidth: StyleSheet.hairlineWidth },
  search: { flexDirection: 'row', alignItems: 'center', height: 38 },
  searchInput: { flex: 1, paddingVertical: 0 },
  tabs: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  tab: { width: 34, height: 32, alignItems: 'center', justifyContent: 'center' },
  cell: { height: CELL, flex: 1, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 28, lineHeight: 34 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
