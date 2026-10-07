import { memo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/useTheme';
import {
  AUDIO_PREF_OPTIONS,
  VIDEO_PREF_OPTIONS,
  type VideoTier,
} from '@/services/webrtc/quality/ladder';
import type { AudioQualityPref, CallMedia, VideoQualityPref } from '@/types/protocol';

import {
  AUDIO_PREF_HINT,
  audioOptionLabel,
  VIDEO_PREF_HINT,
  videoOptionLabel,
} from '../model/qualityUi';

export interface QualitySheetProps {
  visible: boolean;
  onClose: () => void;
  media: CallMedia;
  videoPref: VideoQualityPref;
  audioPref: AudioQualityPref;
  /** Tier we're actually receiving (shown next to Auto, e.g. "Auto (720p)"). */
  receivedTier: VideoTier | null;
  autoLimited: boolean;
  /** What we are sending right now (informational footnote). */
  sendingTier: VideoTier | null;
  onSelectVideo: (pref: VideoQualityPref) => void;
  onSelectAudio: (pref: AudioQualityPref) => void;
}

function OptionRow({
  label,
  hint,
  selected,
  onPress,
  testID,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { colors, spacing, radii } = useTheme();
  return (
    <PressableScale
      testID={testID}
      pressedScale={0.98}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={hint ? `${label}, ${hint}` : label}
      style={[
        styles.row,
        {
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.md,
          borderRadius: radii.md,
          backgroundColor: selected ? colors.primarySoft : 'transparent',
        },
      ]}
    >
      <View style={styles.rowText}>
        <Text variant="body" tint={selected ? colors.primary : colors.text}>
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" color="textTertiary">
            {hint}
          </Text>
        ) : null}
      </View>
      {selected ? <Icon name="checkmark" size={20} tint={colors.primary} /> : null}
    </PressableScale>
  );
}

/**
 * YouTube-style quality picker. The choice sets the quality you RECEIVE: it is sent to the peer
 * (`call.signal{type:"quality"}`), whose sender applies it live without renegotiation.
 */
export const QualitySheet = memo(function QualitySheet({
  visible,
  onClose,
  media,
  videoPref,
  audioPref,
  receivedTier,
  autoLimited,
  sendingTier,
  onSelectVideo,
  onSelectAudio,
}: QualitySheetProps) {
  const { colors, spacing, radii } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title="Call quality">
      <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: spacing.sm }}>
        {media === 'video' ? (
          <View style={{ marginBottom: spacing.lg }}>
            <View style={[styles.sectionHeader, { marginBottom: spacing.xs, gap: spacing.sm }]}>
              <Text variant="subhead" color="textSecondary" accessibilityRole="header">
                Video you receive
              </Text>
              {autoLimited ? (
                <View
                  testID="auto-limited-badge"
                  style={[
                    styles.badge,
                    {
                      backgroundColor: colors.accentSoft,
                      borderRadius: radii.pill,
                      paddingHorizontal: spacing.sm,
                    },
                  ]}
                  accessible
                  accessibilityLabel="Auto-limited: lowered for the connection"
                >
                  <Text variant="micro" tint={colors.accent}>
                    Auto-limited
                  </Text>
                </View>
              ) : null}
            </View>
            {VIDEO_PREF_OPTIONS.map((pref) => (
              <OptionRow
                key={pref}
                testID={`quality-video-${pref}`}
                label={pref === 'auto' ? videoOptionLabel('auto', receivedTier) : pref}
                hint={VIDEO_PREF_HINT[pref] || undefined}
                selected={videoPref === pref}
                onPress={() => onSelectVideo(pref)}
              />
            ))}
          </View>
        ) : null}
        <Text
          variant="subhead"
          color="textSecondary"
          accessibilityRole="header"
          style={{ marginBottom: spacing.xs }}
        >
          Audio you receive
        </Text>
        {AUDIO_PREF_OPTIONS.map((pref) => (
          <OptionRow
            key={pref}
            testID={`quality-audio-${pref}`}
            label={audioOptionLabel(pref)}
            hint={AUDIO_PREF_HINT[pref]}
            selected={audioPref === pref}
            onPress={() => onSelectAudio(pref)}
          />
        ))}
        <Text variant="caption" color="textTertiary" style={{ marginTop: spacing.md }}>
          Changes apply instantly on the other side.
          {media === 'video' && sendingTier ? ` You're sending ${sendingTier}.` : ''}
        </Text>
      </ScrollView>
    </Sheet>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  rowText: { flex: 1, gap: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center' },
  badge: { paddingVertical: 2 },
});
