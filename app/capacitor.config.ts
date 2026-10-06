import type { CapacitorConfig } from '@capacitor/cli';

/**
 * By default the app may talk to a plain `http://` server (e.g. the dev server
 * on your PC over Wi-Fi), so a fresh build works without any setup.
 * For a production release that must only use HTTPS, sync with
 * NAJIK_HTTPS_ONLY=1 and build with `-PnajikHttpsOnly=true` (see README §4.8).
 */
const httpsOnly = process.env.NAJIK_HTTPS_ONLY === '1';

const config: CapacitorConfig = {
  appId: 'com.najik.app',
  appName: 'Najik',
  webDir: 'dist',
  backgroundColor: '#0b0b14',
  server: {
    // http://localhost is still a secure context (camera/mic work) and can reach http:// servers.
    androidScheme: httpsOnly ? 'https' : 'http',
  },
  android: {
    allowMixedContent: !httpsOnly,
    webContentsDebuggingEnabled: process.env.NODE_ENV !== 'production',
  },
  plugins: {
    Keyboard: {
      resize: 'native',
      resizeOnFullScreen: true,
    },
    StatusBar: {
      overlaysWebView: false,
      backgroundColor: '#0b0b14',
      style: 'DARK',
    },
  },
};

export default config;
