import Constants from 'expo-constants';

export type AppEnv = 'development' | 'staging' | 'production';

export interface AppConfig {
  appEnv: AppEnv;
  /** Backend origin, e.g. https://api.najik.app (no trailing slash). */
  apiOrigin: string;
  /** REST base, `${apiOrigin}/api/v1`. */
  apiBaseUrl: string;
  /** WebSocket endpoint, e.g. wss://api.najik.app/ws/v1/ */
  wsUrl: string;
  sentryDsn: string | null;
  isDev: boolean;
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; errors: string[] };

interface RawExtra {
  appEnv?: unknown;
  apiUrl?: unknown;
  wsUrl?: unknown;
  sentryDsn?: unknown;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Validates the runtime config. Non-development builds MUST use https:// and wss://,
 * otherwise the app refuses to start (the root layout renders a config error screen).
 */
export function validateConfig(extra: RawExtra | undefined | null): ConfigResult {
  const errors: string[] = [];
  const appEnv = extra?.appEnv;
  if (appEnv !== 'development' && appEnv !== 'staging' && appEnv !== 'production') {
    return { ok: false, errors: [`Unknown APP_ENV "${String(appEnv)}"`] };
  }
  const isDev = appEnv === 'development';

  const apiRaw = typeof extra?.apiUrl === 'string' ? extra.apiUrl.trim() : '';
  const api = apiRaw ? parseUrl(apiRaw) : null;
  if (!api) {
    errors.push('EXPO_PUBLIC_API_URL is missing or not a valid URL');
  } else if (api.protocol !== 'https:' && !(isDev && api.protocol === 'http:')) {
    errors.push(`API URL must use https:// in ${appEnv} builds`);
  }

  let wsUrl = typeof extra?.wsUrl === 'string' ? extra.wsUrl.trim() : '';
  if (!wsUrl && api) {
    const wsProtocol = api.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${wsProtocol}//${api.host}/ws/v1/`;
  }
  const ws = wsUrl ? parseUrl(wsUrl) : null;
  if (!ws) {
    errors.push('EXPO_PUBLIC_WS_URL is not a valid URL');
  } else if (ws.protocol !== 'wss:' && !(isDev && ws.protocol === 'ws:')) {
    errors.push(`WebSocket URL must use wss:// in ${appEnv} builds`);
  }

  if (errors.length > 0 || !api) return { ok: false, errors };

  const apiOrigin = stripTrailingSlash(apiRaw.replace(/\/api\/v1\/?$/, ''));
  const sentryDsn =
    typeof extra?.sentryDsn === 'string' && extra.sentryDsn.trim() ? extra.sentryDsn.trim() : null;

  return {
    ok: true,
    config: {
      appEnv,
      apiOrigin,
      apiBaseUrl: `${apiOrigin}/api/v1`,
      wsUrl,
      sentryDsn,
      isDev,
    },
  };
}

export const configResult: ConfigResult = validateConfig(
  (Constants.expoConfig?.extra ?? null) as RawExtra | null,
);

/**
 * The validated config. Only call after the root layout confirmed `configResult.ok`;
 * throws otherwise so misconfiguration can never silently talk to the wrong backend.
 */
export function getConfig(): AppConfig {
  if (!configResult.ok) {
    throw new Error(`Invalid app config: ${configResult.errors.join('; ')}`);
  }
  return configResult.config;
}
