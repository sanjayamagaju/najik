import {
  AxiosError,
  AxiosHeaders,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

import type { Tokens } from '@/types/protocol';

import { createApiClient } from '../client';
import { ApiError, normalizeError } from '../errors';
import { TokenManager } from '../tokenManager';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');

function tokens(access: string, accessExpiresInMs = 15 * 60_000): Tokens {
  return {
    access,
    refresh: `refresh-for-${access}`,
    access_expires_at: new Date(NOW + accessExpiresInMs).toISOString(),
    refresh_expires_at: new Date(NOW + 30 * 86_400_000).toISOString(),
  };
}

function memoryStorage(initial: Tokens | null) {
  let value = initial;
  return {
    load: jest.fn(async () => value),
    save: jest.fn(async (t: Tokens) => {
      value = t;
    }),
    clear: jest.fn(async () => {
      value = null;
    }),
    get: () => value,
  };
}

function respond(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown,
  headers: Record<string, string> = {},
) {
  const response: AxiosResponse = { status, statusText: String(status), data, headers, config };
  if (status >= 200 && status < 300) return Promise.resolve(response);
  return Promise.reject(new AxiosError(`HTTP ${status}`, 'ERR_BAD_RESPONSE', config, {}, response));
}

const errorBody = (code: string, message = code, details?: Record<string, string[]>) => ({
  error: { code, message, ...(details ? { details } : {}) },
});

function authHeader(config: InternalAxiosRequestConfig): string | undefined {
  return AxiosHeaders.from(config.headers).get('Authorization') as string | undefined;
}

async function setup(initial: Tokens | null, refreshImpl?: (refresh: string) => Promise<Tokens>) {
  const storage = memoryStorage(initial);
  const refreshRequest = jest.fn(refreshImpl ?? (async () => tokens('new')));
  const manager = new TokenManager({ storage, refreshRequest, now: () => NOW });
  const forced = jest.fn();
  manager.setForcedLogoutHandler(forced);
  await manager.hydrate();
  return { storage, refreshRequest, manager, forced };
}

describe('api client: auth refresh', () => {
  it('refreshes once for many concurrent 401 token_expired responses (single-flight) and replays them', async () => {
    let releaseRefresh: () => void = () => undefined;
    const { manager, refreshRequest, storage } = await setup(
      tokens('old'),
      () =>
        new Promise<Tokens>((resolve) => {
          releaseRefresh = () => resolve(tokens('new'));
        }),
    );
    const seen: (string | undefined)[] = [];
    const api = createApiClient({
      baseURL: 'https://api.test/api/v1',
      tokens: manager,
      adapter: (config) => {
        const auth = authHeader(config);
        seen.push(auth);
        if (auth === 'Bearer old') return respond(config, 401, errorBody('token_expired'));
        return respond(config, 200, { ok: true });
      },
    });

    const requests = Array.from({ length: 5 }, (_, i) => api.get(`/things/${i}`));
    // Let all five fail with 401 before the refresh completes.
    await new Promise((r) => setTimeout(r, 10));
    releaseRefresh();
    const results = await Promise.all(requests);

    expect(refreshRequest).toHaveBeenCalledTimes(1);
    expect(refreshRequest).toHaveBeenCalledWith('refresh-for-old');
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(seen.filter((h) => h === 'Bearer new')).toHaveLength(5);
    expect(storage.get()?.access).toBe('new');
  });

  it('refreshes proactively before the request when the access token is about to expire', async () => {
    const { manager, refreshRequest } = await setup(tokens('old', 30_000));
    const api = createApiClient({
      baseURL: 'https://api.test/api/v1',
      tokens: manager,
      adapter: (config) => respond(config, 200, { auth: authHeader(config) }),
    });
    const res = await api.get('/users/me');
    expect(refreshRequest).toHaveBeenCalledTimes(1);
    expect(res.data).toEqual({ auth: 'Bearer new' });
  });

  it.each(['token_invalid', 'session_revoked'])('forces logout on 401 %s', async (code) => {
    const { manager, forced, storage } = await setup(tokens('old'));
    const api = createApiClient({
      baseURL: 'https://api.test/api/v1',
      tokens: manager,
      adapter: (config) => respond(config, 401, errorBody(code)),
    });
    await expect(api.get('/conversations')).rejects.toMatchObject({ code, status: 401 });
    expect(forced).toHaveBeenCalledWith(code);
    expect(storage.clear).toHaveBeenCalled();
    expect(manager.hasSession()).toBe(false);
  });

  it('forces logout when the refresh token itself is rejected', async () => {
    const { manager, forced } = await setup(tokens('old'), async () => {
      throw new ApiError({ status: 401, code: 'token_invalid', message: 'reused' });
    });
    const api = createApiClient({
      baseURL: 'https://api.test/api/v1',
      tokens: manager,
      adapter: (config) => respond(config, 401, errorBody('token_expired')),
    });
    await expect(api.get('/conversations')).rejects.toBeInstanceOf(ApiError);
    expect(forced).toHaveBeenCalledWith('refresh_rejected');
  });

  it('keeps the session when refresh fails because of the network', async () => {
    const { manager, forced } = await setup(tokens('old'), async () => {
      throw new ApiError({ status: 0, code: 'network_error', message: 'offline' });
    });
    await expect(manager.refresh()).rejects.toMatchObject({ code: 'network_error' });
    expect(forced).not.toHaveBeenCalled();
    expect(manager.hasSession()).toBe(true);
  });

  it('adopts an already-rotated pair from storage instead of re-presenting a used refresh token', async () => {
    const { manager, refreshRequest, storage } = await setup(tokens('old'));
    await storage.save(tokens('rotated-elsewhere'));
    await expect(manager.refresh()).resolves.toBe('rotated-elsewhere');
    expect(refreshRequest).not.toHaveBeenCalled();
  });

  it('notifies listeners (WebSocket re-auth) after a refresh', async () => {
    const { manager } = await setup(tokens('old'));
    const listener = jest.fn();
    manager.onTokensRefreshed(listener);
    await manager.refresh();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ access: 'new' }));
  });

  it('does not attach a token to public endpoints', async () => {
    const { manager } = await setup(tokens('old'));
    const api = createApiClient({
      baseURL: 'https://api.test/api/v1',
      tokens: manager,
      adapter: (config) => respond(config, 200, { auth: authHeader(config) ?? null }),
    });
    const res = await api.post('/auth/login', {}, { skipAuth: true });
    expect(res.data).toEqual({ auth: null });
  });
});

describe('api client: retries', () => {
  const noSleep = async () => undefined;

  it('retries idempotent GETs on 503 with backoff', async () => {
    const { manager } = await setup(tokens('old'));
    let calls = 0;
    const sleep = jest.fn(noSleep);
    const api = createApiClient({
      baseURL: 'https://api.test/api/v1',
      tokens: manager,
      sleep,
      random: () => 0.5,
      adapter: (config) =>
        ++calls < 3
          ? respond(config, 503, errorBody('server_error'))
          : respond(config, 200, { ok: 1 }),
    });
    await expect(api.get('/conversations')).resolves.toMatchObject({ status: 200 });
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-idempotent POSTs', async () => {
    const { manager } = await setup(tokens('old'));
    let calls = 0;
    const api = createApiClient({
      baseURL: 'https://api.test/api/v1',
      tokens: manager,
      sleep: noSleep,
      adapter: (config) => {
        calls++;
        return respond(config, 503, errorBody('server_error'));
      },
    });
    await expect(api.post('/auth/password', {})).rejects.toMatchObject({ code: 'server_error' });
    expect(calls).toBe(1);
  });

  it('retries POSTs explicitly marked idempotent (client_id sends) on network errors', async () => {
    const { manager } = await setup(tokens('old'));
    let calls = 0;
    const api = createApiClient({
      baseURL: 'https://api.test/api/v1',
      tokens: manager,
      sleep: noSleep,
      adapter: (config) => {
        calls++;
        if (calls === 1)
          return Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config));
        return respond(config, 200, { id: 'm1' });
      },
    });
    await expect(
      api.post('/conversations/c/messages', { client_id: 'k' }, { idempotent: true }),
    ).resolves.toMatchObject({ status: 200 });
    expect(calls).toBe(2);
  });

  it('honours Retry-After on 429 for idempotent requests', async () => {
    const { manager } = await setup(tokens('old'));
    const sleep = jest.fn(noSleep);
    let calls = 0;
    const api = createApiClient({
      baseURL: 'https://api.test/api/v1',
      tokens: manager,
      sleep,
      adapter: (config) =>
        ++calls === 1
          ? respond(config, 429, errorBody('rate_limited'), { 'retry-after': '3' })
          : respond(config, 200, {}),
    });
    await api.get('/users/search');
    expect(sleep).toHaveBeenCalledWith(3000);
  });
});

describe('error normalization', () => {
  it('maps the contract error shape', () => {
    const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
    const err = new AxiosError(
      'x',
      'ERR_BAD_REQUEST',
      config,
      {},
      {
        status: 400,
        statusText: 'Bad',
        config,
        headers: {},
        data: errorBody('validation_error', 'Invalid', { username: ['Taken'] }),
      },
    );
    const e = normalizeError(err);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 400, code: 'validation_error', message: 'Invalid' });
    expect(e.fieldError('username')).toBe('Taken');
  });

  it('falls back to a status-derived code for non-contract bodies', () => {
    const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
    const err = new AxiosError(
      'x',
      'ERR',
      config,
      {},
      { status: 502, statusText: '', config, headers: {}, data: '<html>' },
    );
    expect(normalizeError(err)).toMatchObject({ code: 'server_error', status: 502 });
  });

  it('maps network failures and timeouts', () => {
    const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
    expect(normalizeError(new AxiosError('Network Error', 'ERR_NETWORK', config))).toMatchObject({
      code: 'network_error',
    });
    expect(normalizeError(new AxiosError('timeout', 'ECONNABORTED', config))).toMatchObject({
      code: 'timeout',
    });
    expect(normalizeError(new AxiosError('canceled', 'ERR_CANCELED', config))).toMatchObject({
      code: 'cancelled',
    });
  });
});
