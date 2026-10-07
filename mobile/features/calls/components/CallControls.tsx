import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import type { CallMedia } from '@/types/protocol';

import { CallControlButton } from './CallControlButton';

export interface CallControlsProps {
  media: CallMedia;
  micMuted: boolean;
  speakerOn: boolean;
  cameraOn: boolean;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onToggleCamera: () => void;
  onFlipCamera: () => void;
  onEnd: () => void;
  /** Before the call connects only mute/speaker/end make sense. */
  compact?: boolean;
}

export const CallControls = memo(function CallControls({
  media,
  micMuted,
  speakerOn,
  cameraOn,
  onToggleMute,
  onToggleSpeaker,
  onToggleCamera,
  onFlipCamera,
  onEnd,
  compact,
}: CallControlsProps) {
  const { spacing } = useTheme();
  const video = media === 'video';
  return (
    <View style={[styles.root, { gap: spacing.lg }]}>
      <View style={[styles.row, { gap: spacing.md }]}>
        {video && !compact ? (
          <CallControlButton
            testID="call-flip"
            icon="camera-reverse-outline"
            label="Flip"
            accessibilityLabel="Switch camera"
            onPress={onFlipCamera}
            disabled={!cameraOn}
          />
        ) : null}
        {video ? (
          <CallControlButton
            testID="call-camera"
            icon={cameraOn ? 'videocam' : 'videocam-off'}
            label={cameraOn ? 'Camera' : 'Camera off'}
            accessibilityLabel="Camera"
            active={!cameraOn}
            onPress={onToggleCamera}
          />
        ) : (
          <CallControlButton
            testID="call-video-upgrade"
            icon="videocam-outline"
            label="Video"
            accessibilityHint="Switching a voice call to video isn't available yet"
            disabled
          />
        )}
        <CallControlButton
          testID="call-mute"
          icon={micMuted ? 'mic-off' : 'mic'}
          label={micMuted ? 'Unmute' : 'Mute'}
          accessibilityLabel="Mute microphone"
          active={micMuted}
          onPress={onToggleMute}
        />
        <CallControlButton
          testID="call-speaker"
          icon={speakerOn ? 'volume-high' : 'volume-medium-outline'}
          label="Speaker"
          accessibilityLabel="Speaker"
          active={speakerOn}
          onPress={onToggleSpeaker}
        />
      </View>
      <CallControlButton
        testID="call-end"
        icon="call"
        label="End"
        accessibilityLabel="End call"
        variant="danger"
        rotateIcon
        size={72}
        onPress={onEnd}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { alignItems: 'center' },
  row: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' },
});
