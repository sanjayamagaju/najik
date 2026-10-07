import { useKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RTCView } from 'react-native-webrtc';

import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/useTheme';
import { haptics } from '@/utils/haptics';

import { CallControls } from '../components/CallControls';
import { CallDuration } from '../components/CallDuration';
import { CallEndedView } from '../components/CallEndedView';
import { CALL_SURFACE } from '../components/callSurface';
import { IncomingCallView } from '../components/IncomingCallView';
import { LocalPreview } from '../components/LocalPreview';
import { NetworkQualityBars } from '../components/NetworkQualityBars';
import { PulsingAvatar } from '../components/PulsingAvatar';
import { QualitySheet } from '../components/QualitySheet';
import { ReconnectingOverlay } from '../components/ReconnectingOverlay';
import { type CallMachineState, isLive } from '../model/callMachine';
import { isReceiveAutoLimited, receivedVideoTier } from '../model/qualityUi';
import { callController } from '../services/callService';
import { callStore, useCallStore } from '../store/callStore';

const CONTROLS_HIDE_MS = 4_000;

function KeepAwake() {
  useKeepAwake('najik-call');
  return null;
}

function statusText(machine: CallMachineState): string {
  switch (machine.phase) {
    case 'outgoing':
      return 'Calling…';
    case 'ringing':
      return 'Ringing…';
    case 'connecting':
      return 'Connecting…';
    case 'reconnecting':
      return 'Reconnecting…';
    default:
      return '';
  }
}

const controls = {
  mute: () => {
    haptics.selection();
    callController.toggleMute();
  },
  speaker: () => {
    haptics.selection();
    callController.toggleSpeaker();
  },
  camera: () => {
    haptics.selection();
    callController.toggleCamera();
  },
  flip: () => {
    haptics.selection();
    void callController.flipCamera();
  },
  end: () => {
    haptics.medium();
    callController.hangup();
  },
};

function useQualitySheet() {
  const [open, setOpen] = useState(false);
  const media = useCallStore((s) => s.machine.media);
  const videoPref = useCallStore((s) => s.videoPref);
  const audioPref = useCallStore((s) => s.audioPref);
  const stats = useCallStore((s) => s.stats);
  const remoteVideoEnabled = useCallStore((s) => s.remoteVideoEnabled);
  const sendDecision = useCallStore((s) => s.sendDecision);
  const received = receivedVideoTier(stats);
  const sheet = (
    <QualitySheet
      visible={open}
      onClose={() => setOpen(false)}
      media={media}
      videoPref={videoPref}
      audioPref={audioPref}
      receivedTier={received}
      autoLimited={isReceiveAutoLimited(videoPref, received, remoteVideoEnabled)}
      sendingTier={sendDecision?.video.tier ?? null}
      onSelectVideo={(pref) => {
        haptics.selection();
        callController.setVideoPreference(pref);
      }}
      onSelectAudio={(pref) => {
        haptics.selection();
        callController.setAudioPreference(pref);
      }}
    />
  );
  return { open: () => setOpen(true), sheet };
}

function QualityButton({ onPress }: { onPress: () => void }) {
  const networkLevel = useCallStore((s) => s.networkLevel);
  const { spacing, radii } = useTheme();
  return (
    <PressableScale
      testID="call-quality"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Call quality settings"
      hitSlop={8}
      style={[
        styles.chip,
        { gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.pill },
      ]}
    >
      <NetworkQualityBars level={networkLevel} />
      <Icon name="options-outline" size={16} tint={CALL_SURFACE.text} />
    </PressableScale>
  );
}

// ───────────────────────── audio (and pre-connect) ─────────────────────────

function AudioCallView({ machine }: { machine: CallMachineState }) {
  const { spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const micMuted = useCallStore((s) => s.micMuted);
  const speakerOn = useCallStore((s) => s.speakerOn);
  const remoteAudioMuted = useCallStore((s) => s.remoteAudioMuted);
  const quality = useQualitySheet();
  const peer = machine.peer;
  const live = machine.phase === 'connected' || machine.phase === 'reconnecting';
  const pulsing = ['outgoing', 'ringing', 'connecting'].includes(machine.phase);

  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient colors={CALL_SURFACE.gradient} style={StyleSheet.absoluteFill} />
      <View
        style={[
          styles.topBar,
          { paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg },
        ]}
      >
        <Text variant="subhead" tint={CALL_SURFACE.textSecondary}>
          Voice call
        </Text>
        {live ? <QualityButton onPress={quality.open} /> : null}
      </View>
      <View style={[styles.center, { gap: spacing.md }]}>
        <PulsingAvatar
          name={peer?.display_name ?? ''}
          color={peer?.avatar_color ?? '#7B4DFF'}
          size={148}
          pulsing={pulsing}
        />
        <Text
          variant="display"
          tint={CALL_SURFACE.text}
          align="center"
          numberOfLines={2}
          accessibilityRole="header"
          style={{ paddingHorizontal: spacing.xl }}
        >
          {peer?.display_name ?? ''}
        </Text>
        <View style={[styles.statusRow, { gap: spacing.sm }]}>
          {machine.phase === 'connected' && machine.connectedAt ? (
            <CallDuration
              since={machine.connectedAt}
              variant="headline"
              tint={CALL_SURFACE.textSecondary}
            />
          ) : (
            <Text
              variant="headline"
              tint={CALL_SURFACE.textSecondary}
              accessibilityLiveRegion="polite"
            >
              {statusText(machine)}
            </Text>
          )}
          {remoteAudioMuted && live ? (
            <Icon name="mic-off" size={16} tint={CALL_SURFACE.textSecondary} />
          ) : null}
        </View>
      </View>
      <View style={{ paddingBottom: insets.bottom + spacing.xxl }}>
        <CallControls
          media="audio"
          micMuted={micMuted}
          speakerOn={speakerOn}
          cameraOn={false}
          compact={!live}
          onToggleMute={controls.mute}
          onToggleSpeaker={controls.speaker}
          onToggleCamera={controls.camera}
          onFlipCamera={controls.flip}
          onEnd={controls.end}
        />
      </View>
      {machine.phase === 'reconnecting' ? <ReconnectingOverlay /> : null}
      {quality.sheet}
    </View>
  );
}

// ───────────────────────── video ─────────────────────────

function VideoCallView({ machine }: { machine: CallMachineState }) {
  const { spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const micMuted = useCallStore((s) => s.micMuted);
  const speakerOn = useCallStore((s) => s.speakerOn);
  const cameraOn = useCallStore((s) => s.cameraOn);
  const facing = useCallStore((s) => s.facing);
  const localUrl = useCallStore((s) => s.localStreamUrl);
  const remoteUrl = useCallStore((s) => s.remoteStreamUrl);
  const remoteVideoEnabled = useCallStore((s) => s.remoteVideoEnabled);
  const remoteAudioMuted = useCallStore((s) => s.remoteAudioMuted);
  const quality = useQualitySheet();
  const [controlsShown, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peer = machine.peer;
  const live = machine.phase === 'connected' || machine.phase === 'reconnecting';
  const showRemote = live && !!remoteUrl && remoteVideoEnabled;
  // Controls only auto-hide over live remote video.
  const controlsVisible = controlsShown || !showRemote;

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => {
    if (showRemote) scheduleHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [showRemote, scheduleHide]);

  const onSurfaceTap = () => {
    if (!showRemote) return;
    if (controlsVisible) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setControlsVisible(false);
    } else {
      setControlsVisible(true);
      scheduleHide();
    }
  };

  const controlsHeight = controlsVisible ? 230 + insets.bottom : insets.bottom + spacing.xl;

  return (
    <View style={[StyleSheet.absoluteFill, styles.black]}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onSurfaceTap}
        accessibilityRole="button"
        accessibilityLabel={controlsVisible ? 'Hide call controls' : 'Show call controls'}
      >
        {showRemote ? (
          <RTCView
            streamURL={remoteUrl}
            style={StyleSheet.absoluteFill}
            objectFit="cover"
            zOrder={0}
          />
        ) : !live && cameraOn && localUrl ? (
          // Before the call connects the caller sees their own camera full-bleed.
          <>
            <RTCView
              streamURL={localUrl}
              style={StyleSheet.absoluteFill}
              objectFit="cover"
              mirror={facing === 'user'}
              zOrder={0}
            />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: CALL_SURFACE.scrim }]} />
          </>
        ) : (
          <LinearGradient colors={CALL_SURFACE.gradient} style={StyleSheet.absoluteFill} />
        )}
      </Pressable>

      {!showRemote ? (
        <View
          style={[styles.center, styles.overlayCenter, { gap: spacing.md }]}
          pointerEvents="none"
        >
          <PulsingAvatar
            name={peer?.display_name ?? ''}
            color={peer?.avatar_color ?? '#7B4DFF'}
            size={120}
            pulsing={!live}
          />
          <Text variant="title" tint={CALL_SURFACE.text} align="center" numberOfLines={2}>
            {peer?.display_name ?? ''}
          </Text>
          <Text
            variant="headline"
            tint={CALL_SURFACE.textSecondary}
            accessibilityLiveRegion="polite"
          >
            {live
              ? remoteVideoEnabled
                ? 'Waiting for video…'
                : 'Camera is off'
              : statusText(machine)}
          </Text>
        </View>
      ) : null}

      {live ? (
        <LocalPreview
          streamUrl={localUrl}
          mirror={facing === 'user'}
          cameraOn={cameraOn}
          bottomInset={controlsHeight}
        />
      ) : null}

      {controlsVisible ? (
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(200)}
          style={[
            styles.topBar,
            styles.videoTopBar,
            { paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg },
          ]}
        >
          {showRemote && peer ? (
            <View style={[styles.statusRow, { gap: spacing.sm }]}>
              <Avatar name={peer.display_name} color={peer.avatar_color} size={32} />
              <View>
                <Text variant="headline" tint={CALL_SURFACE.text} numberOfLines={1}>
                  {peer.display_name}
                </Text>
                {machine.connectedAt ? (
                  <CallDuration
                    since={machine.connectedAt}
                    variant="caption"
                    tint={CALL_SURFACE.textSecondary}
                  />
                ) : null}
              </View>
              {remoteAudioMuted ? (
                <View
                  style={[styles.mutedChip, { padding: spacing.xs }]}
                  accessibilityLabel={`${peer.display_name} is muted`}
                  accessible
                >
                  <Icon name="mic-off" size={14} tint={CALL_SURFACE.text} />
                </View>
              ) : null}
            </View>
          ) : (
            <Text variant="subhead" tint={CALL_SURFACE.textSecondary}>
              Video call
            </Text>
          )}
          {live ? <QualityButton onPress={quality.open} /> : null}
        </Animated.View>
      ) : null}

      {controlsVisible ? (
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(200)}
          style={[
            styles.bottom,
            { paddingBottom: insets.bottom + spacing.xxl, paddingTop: spacing.lg },
          ]}
        >
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <CallControls
            media="video"
            micMuted={micMuted}
            speakerOn={speakerOn}
            cameraOn={cameraOn}
            compact={!live}
            onToggleMute={() => {
              controls.mute();
              scheduleHide();
            }}
            onToggleSpeaker={() => {
              controls.speaker();
              scheduleHide();
            }}
            onToggleCamera={() => {
              controls.camera();
              scheduleHide();
            }}
            onFlipCamera={() => {
              controls.flip();
              scheduleHide();
            }}
            onEnd={controls.end}
          />
        </Animated.View>
      ) : null}

      {machine.phase === 'reconnecting' ? <ReconnectingOverlay /> : null}
      {quality.sheet}
    </View>
  );
}

// ───────────────────────── screen ─────────────────────────

/** The full call experience behind `/call/[peerId]`. Renders whatever phase the call is in. */
export function CallScreen({ onExit }: { onExit: () => void }) {
  const machine = useCallStore((s) => s.machine);
  const live = isLive(machine.phase);

  useEffect(() => {
    callStore.setState({ screenOpen: true });
    return () => callStore.setState({ screenOpen: false });
  }, []);

  // Hardware back must not drop a live call.
  useEffect(() => {
    if (!live) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [live]);

  const close = useCallback(() => {
    callController.dismissEnded();
    onExit();
  }, [onExit]);

  const callAgain = useCallback(() => {
    const { peer, media, conversationId } = callStore.getState().machine;
    if (!peer) return;
    callController.dismissEnded();
    void callController.startOutgoing({ peer, media, conversationId });
  }, []);

  let content: ReactNode;
  if (machine.phase === 'idle') {
    content = (
      <View style={StyleSheet.absoluteFill}>
        <LinearGradient colors={CALL_SURFACE.gradient} style={StyleSheet.absoluteFill} />
      </View>
    );
  } else if (machine.phase === 'ended') {
    content = <CallEndedView machine={machine} onClose={close} onCallAgain={callAgain} />;
  } else if (machine.phase === 'incoming' && machine.peer) {
    content = (
      <IncomingCallView
        peer={machine.peer}
        media={machine.media}
        onAccept={() => void callController.accept()}
        onDecline={() => callController.decline()}
      />
    );
  } else if (machine.media === 'video') {
    content = <VideoCallView machine={machine} />;
  } else {
    content = <AudioCallView machine={machine} />;
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.black]}>
      {live ? <KeepAwake /> : null}
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  black: { backgroundColor: '#000000' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  videoTopBar: { position: 'absolute', top: 0, left: 0, right: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overlayCenter: { ...StyleSheet.absoluteFill },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 34,
    backgroundColor: CALL_SURFACE.chip,
  },
  mutedChip: { borderRadius: 999, backgroundColor: CALL_SURFACE.chip },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
