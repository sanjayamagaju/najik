import { validateConfig } from '../env';

describe('runtime config guard', () => {
  it('accepts https/wss in production and derives the REST base', () => {
    const result = validateConfig({
      appEnv: 'production',
      apiUrl: 'https://api.najik.test/',
      wsUrl: 'wss://api.najik.test/ws/v1/',
      sentryDsn: 'https://key@o0.ingest.sentry.io/1',
    });
    expect(result).toEqual({
      ok: true,
      config: {
        appEnv: 'production',
        apiOrigin: 'https://api.najik.test',
        apiBaseUrl: 'https://api.najik.test/api/v1',
        wsUrl: 'wss://api.najik.test/ws/v1/',
        sentryDsn: 'https://key@o0.ingest.sentry.io/1',
        isDev: false,
      },
    });
  });

  it('derives the WebSocket URL from the API origin when omitted', () => {
    const result = validateConfig({
      appEnv: 'staging',
      apiUrl: 'https://staging.najik.test/api/v1',
    });
    expect(result.ok && result.config.wsUrl).toBe('wss://staging.najik.test/ws/v1/');
    expect(result.ok && result.config.apiBaseUrl).toBe('https://staging.najik.test/api/v1');
  });

  it.each(['staging', 'production'])('refuses http:// and ws:// in %s', (appEnv) => {
    const http = validateConfig({
      appEnv,
      apiUrl: 'http://api.najik.test',
      wsUrl: 'wss://api.najik.test/ws/v1/',
    });
    expect(http.ok).toBe(false);
    const ws = validateConfig({
      appEnv,
      apiUrl: 'https://api.najik.test',
      wsUrl: 'ws://api.najik.test/ws/v1/',
    });
    expect(ws.ok).toBe(false);
    expect(!ws.ok && ws.errors.join()).toMatch(/wss:\/\//);
  });

  it('allows cleartext only in development', () => {
    const result = validateConfig({ appEnv: 'development', apiUrl: 'http://10.0.2.2:8000' });
    expect(result.ok && result.config.wsUrl).toBe('ws://10.0.2.2:8000/ws/v1/');
  });

  it('rejects unknown environments, missing and malformed URLs', () => {
    expect(validateConfig({ appEnv: 'qa', apiUrl: 'https://x.test' }).ok).toBe(false);
    expect(validateConfig({ appEnv: 'production', apiUrl: '' }).ok).toBe(false);
    expect(validateConfig({ appEnv: 'production', apiUrl: 'not a url' }).ok).toBe(false);
    expect(validateConfig(null).ok).toBe(false);
  });

  it('treats an empty DSN as "monitoring disabled"', () => {
    const result = validateConfig({
      appEnv: 'production',
      apiUrl: 'https://a.test',
      sentryDsn: '  ',
    });
    expect(result.ok && result.config.sentryDsn).toBeNull();
  });
});
