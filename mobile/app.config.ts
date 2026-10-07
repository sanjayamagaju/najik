import { existsSync } from 'node:fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Najik app config. Everything environment-specific comes from env vars set per
 * EAS build profile (see eas.json) or a local `.env` file. NO secrets live here:
 * only public endpoints and the (public) Sentry DSN end up in `extra`.
 */
type AppEnv = 'development' | 'staging' | 'production';

const APP_ENV: AppEnv = (() => {
  const raw = process.env.APP_ENV ?? 'development';
  if (raw === 'development' || raw === 'staging' || raw === 'production') return raw;
  throw new Error(`APP_ENV must be development | staging | production (got "${raw}")`);
})();

const IS_DEV = APP_ENV === 'development';

const VARIANT = {
  development: { name: 'Najik Dev', suffix: '.dev', scheme: 'najik-dev' },
  staging: { name: 'Najik Staging', suffix: '.staging', scheme: 'najik-staging' },
  production: { name: 'Najik', suffix: '', scheme: 'najik' },
}[APP_ENV];

const BUNDLE_ID = `com.najik.app${VARIANT.suffix}`;

// Firebase / APNs config files are provided as EAS "file" environment variables
// (GOOGLE_SERVICES_JSON) and are never committed.
const googleServicesFile =
  process.env.GOOGLE_SERVICES_JSON ??
  (existsSync('./google-services.json') ? './google-services.json' : undefined);

const BRAND_DEEP = '#3F2FD1';

const MIC_USAGE = 'Najik uses the microphone for voice and video calls.';
const CAMERA_USAGE = 'Najik uses the camera for video calls.';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: VARIANT.name,
  slug: 'najik',
  owner: process.env.EXPO_OWNER,
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: VARIANT.scheme,
  userInterfaceStyle: 'automatic',
  backgroundColor: '#0B0A12',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: true,
    icon: './assets/images/icon.png',
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSMicrophoneUsageDescription: MIC_USAGE,
      NSCameraUsageDescription: CAMERA_USAGE,
      // voip: PushKit incoming calls (CallKit). audio: keep the call alive when backgrounded.
      // remote-notification: data pushes (`call.ended`, pings) wake the background task.
      UIBackgroundModes: ['audio', 'voip', 'remote-notification'],
    },
  },
  android: {
    package: BUNDLE_ID,
    googleServicesFile,
    allowBackup: false,
    adaptiveIcon: {
      backgroundColor: BRAND_DEEP,
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    permissions: [
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.VIBRATE',
      'android.permission.ACCESS_NETWORK_STATE',
      // Calls (react-native-webrtc + incall-manager)
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.WAKE_LOCK',
      // Incoming-call UX (modules/najik-calls): full-screen ringing notification + typed
      // foreground service while a call is connected (Android 14+).
      'android.permission.USE_FULL_SCREEN_INTENT',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.FOREGROUND_SERVICE_CAMERA',
    ],
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_AUDIO',
      ...(IS_DEV ? [] : ['android.permission.SYSTEM_ALERT_WINDOW']),
    ],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: BRAND_DEEP,
        image: './assets/images/splash-icon.png',
        imageWidth: 112,
        dark: { backgroundColor: '#0B0A12', image: './assets/images/splash-icon.png' },
      },
    ],
    'expo-secure-store',
    [
      '@config-plugins/react-native-webrtc',
      { cameraPermission: CAMERA_USAGE, microphonePermission: MIC_USAGE },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/images/notification-icon.png',
        color: '#6C47FF',
        defaultChannel: 'messages',
        mode: IS_DEV ? 'development' : 'production',
        enableBackgroundRemoteNotifications: true,
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          // Cleartext HTTP/WS is only allowed for local development backends.
          usesCleartextTraffic: IS_DEV,
        },
      },
    ],
    [
      '@sentry/react-native/expo',
      {
        // Source-map upload reads SENTRY_AUTH_TOKEN from the (EAS secret) environment.
        organization: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        url: process.env.SENTRY_URL ?? 'https://sentry.io/',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    appEnv: APP_ENV,
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? (IS_DEV ? 'http://localhost:8000' : ''),
    wsUrl: process.env.EXPO_PUBLIC_WS_URL ?? '',
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
});
