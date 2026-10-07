/* Global test setup: deterministic native-module mocks. */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must use require() */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

jest.mock('expo-crypto', () => ({
  randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID(),
}));

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  wrap: (c: unknown) => c,
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
  setUser: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: { appEnv: 'development', apiUrl: 'http://localhost:8000', wsUrl: '', sentryDsn: '' },
    },
  },
}));

jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));

// Remote-push native module is not available under Jest; only the APIs used by pure code paths.
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  setNotificationHandler: jest.fn(),
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
}));

// WebRTC + call audio native modules (calls feature). The engine is typed against small
// interfaces and tests inject fakes (services/webrtc/testing/fakes.ts); these mocks only keep
// imports of the real libraries inert.
jest.mock('react-native-webrtc', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  const RTCView = (props: Record<string, unknown>) =>
    React.createElement(View, { ...props, testID: (props.testID as string) ?? 'rtc-view' });
  return {
    RTCView,
    RTCPeerConnection: jest.fn(),
    RTCAudioSession: { audioSessionDidActivate: jest.fn(), audioSessionDidDeactivate: jest.fn() },
    mediaDevices: { getUserMedia: jest.fn(() => Promise.reject(new Error('not in tests'))) },
  };
});

jest.mock('react-native-incall-manager', () => ({
  __esModule: true,
  default: {
    start: jest.fn(),
    stop: jest.fn(),
    setForceSpeakerphoneOn: jest.fn(),
    startRingtone: jest.fn(),
    stopRingtone: jest.fn(),
    startRingback: jest.fn(),
    stopRingback: jest.fn(),
  },
}));

jest.mock('expo-keep-awake', () => ({
  useKeepAwake: jest.fn(),
  activateKeepAwakeAsync: jest.fn(() => Promise.resolve()),
  deactivateKeepAwake: jest.fn(() => Promise.resolve()),
}));
