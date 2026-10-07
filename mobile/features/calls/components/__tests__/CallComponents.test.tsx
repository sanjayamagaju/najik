import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  formatCallDuration,
  isReceiveAutoLimited,
  receivedVideoTier,
  videoOptionLabel,
} from '../../model/qualityUi';
import { CallControls, type CallControlsProps } from '../CallControls';
import { NetworkQualityBars } from '../NetworkQualityBars';
import { QualitySheet, type QualitySheetProps } from '../QualitySheet';

async function controls(overrides: Partial<CallControlsProps> = {}) {
  const props: CallControlsProps = {
    media: 'video',
    micMuted: false,
    speakerOn: true,
    cameraOn: true,
    onToggleMute: jest.fn(),
    onToggleSpeaker: jest.fn(),
    onToggleCamera: jest.fn(),
    onFlipCamera: jest.fn(),
    onEnd: jest.fn(),
    ...overrides,
  };
  await render(<CallControls {...props} />);
  return props;
}

describe('CallControls', () => {
  it('video: flip, camera, mute, speaker and end with accessible toggle state', async () => {
    const props = await controls({ micMuted: true });
    await fireEvent.press(screen.getByLabelText('Switch camera'));
    await fireEvent.press(screen.getByLabelText('Camera'));
    await fireEvent.press(screen.getByLabelText('Mute microphone'));
    await fireEvent.press(screen.getByLabelText('Speaker'));
    await fireEvent.press(screen.getByLabelText('End call'));
    expect(props.onFlipCamera).toHaveBeenCalled();
    expect(props.onToggleCamera).toHaveBeenCalled();
    expect(props.onToggleMute).toHaveBeenCalled();
    expect(props.onToggleSpeaker).toHaveBeenCalled();
    expect(props.onEnd).toHaveBeenCalled();
    expect(screen.getByLabelText('Mute microphone').props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(screen.getByText('Unmute')).toBeTruthy();
  });

  it('audio: video upgrade is shown but disabled in v1, no camera controls', async () => {
    const props = await controls({ media: 'audio', cameraOn: false });
    expect(screen.queryByLabelText('Switch camera')).toBeNull();
    const upgrade = screen.getByTestId('call-video-upgrade');
    expect(upgrade.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByLabelText('End call'));
    expect(props.onEnd).toHaveBeenCalledTimes(1);
  });

  it('compact (pre-connect) hides the camera flip', async () => {
    await controls({ compact: true });
    expect(screen.queryByLabelText('Switch camera')).toBeNull();
    expect(screen.getByLabelText('Mute microphone')).toBeTruthy();
  });
});

async function sheet(overrides: Partial<QualitySheetProps> = {}) {
  const props: QualitySheetProps = {
    visible: true,
    onClose: jest.fn(),
    media: 'video',
    videoPref: 'auto',
    audioPref: 'auto',
    receivedTier: '720p',
    autoLimited: false,
    sendingTier: '480p',
    onSelectVideo: jest.fn(),
    onSelectAudio: jest.fn(),
    ...overrides,
  };
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <QualitySheet {...props} />
    </SafeAreaProvider>,
  );
  return props;
}

describe('QualitySheet', () => {
  it('shows "Auto (720p)" with the actual received resolution and all ladder options', async () => {
    await sheet();
    expect(screen.getByText('Auto (720p)')).toBeTruthy();
    for (const tier of ['1080p', '720p', '480p', '360p', '240p', '144p']) {
      expect(screen.getByTestId(`quality-video-${tier}`)).toBeTruthy();
    }
    expect(screen.getByTestId('quality-video-auto').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByText(/You're sending 480p/)).toBeTruthy();
  });

  it('switches video and audio quality live', async () => {
    const props = await sheet();
    await fireEvent.press(screen.getByTestId('quality-video-360p'));
    await fireEvent.press(screen.getByTestId('quality-audio-low'));
    expect(props.onSelectVideo).toHaveBeenCalledWith('360p');
    expect(props.onSelectAudio).toHaveBeenCalledWith('low');
  });

  it('shows the Auto-limited badge when a manual pick is undercut', async () => {
    await sheet({ videoPref: '1080p', autoLimited: true });
    expect(screen.getByTestId('auto-limited-badge')).toBeTruthy();
    expect(screen.getByText('Auto-limited')).toBeTruthy();
  });

  it('audio calls only offer audio quality', async () => {
    await sheet({ media: 'audio' });
    expect(screen.queryByTestId('quality-video-auto')).toBeNull();
    expect(screen.getByTestId('quality-audio-high')).toBeTruthy();
  });
});

describe('NetworkQualityBars', () => {
  it('announces the level', async () => {
    await render(<NetworkQualityBars level={1} />);
    expect(screen.getByLabelText('Network quality poor')).toBeTruthy();
  });
});

describe('quality UI helpers', () => {
  it('labels, received tier and auto-limited detection', async () => {
    expect(videoOptionLabel('auto', '480p')).toBe('Auto (480p)');
    expect(videoOptionLabel('auto', null)).toBe('Auto');
    expect(videoOptionLabel('720p', '480p')).toBe('720p');
    const stats = { inboundVideo: { width: 720, height: 1280, fps: 30 } } as Parameters<
      typeof receivedVideoTier
    >[0];
    expect(receivedVideoTier(stats)).toBe('720p'); // portrait frames use the short edge
    expect(isReceiveAutoLimited('720p', '480p', true)).toBe(true);
    expect(isReceiveAutoLimited('720p', '720p', true)).toBe(false);
    expect(isReceiveAutoLimited('auto', '144p', true)).toBe(false);
    expect(isReceiveAutoLimited('720p', '144p', false)).toBe(false);
    expect(formatCallDuration(65)).toBe('1:05');
    expect(formatCallDuration(3_725)).toBe('1:02:05');
  });
});
