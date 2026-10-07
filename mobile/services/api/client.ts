import axios, {
  AxiosHeaders,
  isAxiosError,
  type AxiosAdapter,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';

import { fullJitterBackoff, sleep as defaultSleep } from '@/utils/backoff';

import { ApiError, FORCED_LOGOUT_CODES, normalizeError } from './errors';
import type { TokenManager } from './tokenManager';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Public endpoint: do not attach the bearer token. */
    skipAuth?: boolean;
    /** Safe to retry on network failure even though the method is not idempotent (e.g. client_id sends). */
    idempotent?: boolean;
    /** Override the number of automatic retries (default 2). */
    maxRetries?: number;
    /** @internal */
    _retryCount?: number;
    /** @internal */
    _authRetried?: boolean;
  }
}

const IDEMPOTENT_METHODS = new Set(['get', 'head', 'options', 'put', 'delete']);
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_RETRY_AFTER_SEC = 30;

export interface ApiClientDeps {
  baseURL: string;
  tokens: Pick<TokenManager, 'getValidAccessToken' | 'refresh' | 'forceLogout' | 'hasSession'>;
  timeoutMs?: number;
  adapter?: AxiosAdapter;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function isIdempotent(config: InternalAxiosRequestConfig): boolean {
  return (
    config.idempotent === true || IDEMPOTENT_METHODS.has((config.method ?? 'get').toLowerCase())
  );
}

function retryDelayMs(error: ApiError, attempt: number, random: () => number): number | null {
  if (error.code === 'network_error' || error.code === 'timeout') {
    return fullJitterBackoff(attempt, { baseMs: 400, capMs: 4_000 }, random) + 100;
  }
  if (RETRYABLE_STATUS.has(error.status)) {
    return fullJitterBackoff(attempt, { baseMs: 500, capMs: 5_000 }, random) + 100;
  }
  if (
    error.status === 429 &&
    error.retryAfterSec !== null &&
    error.retryAfterSec <= MAX_RETRY_AFTER_SEC
  ) {
    return error.retryAfterSec * 1000;
  }
  return null;
}

/**
 * Axios instance with:
 *  - bearer auth + proactive refresh (request interceptor),
 *  - reactive single-flight refresh on 401 `token_expired`, then one replay,
 *  - forced logout on `token_invalid` / `session_revoked`,
 *  - retry with full-jitter backoff for idempotent requests,
 *  - every failure normalized to `ApiError` (PROTOCOL §1 shape).
 */
export function createApiClient(deps: ApiClientDeps): AxiosInstance {
  const random = deps.random ?? Math.random;
  const sleep = deps.sleep ?? defaultSleep;
  // eslint-disable-next-line import/no-named-as-default-member -- `create` is only reliably available on the default export at runtime
  const instance = axios.create({
    baseURL: deps.baseURL,
    timeout: deps.timeoutMs ?? 15_000,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    adapter: deps.adapter,
  });

  instance.interceptors.request.use(async (config) => {
    if (config.skipAuth) return config;
    const token = await deps.tokens.getValidAccessToken();
    const headers = AxiosHeaders.from(config.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    else headers.delete('Authorization');
    config.headers = headers;
    return config;
  });

  instance.interceptors.response.use(undefined, async (rawError: unknown) => {
    const error = normalizeError(rawError);
    const config = isAxiosError(rawError)
      ? (rawError.config as InternalAxiosRequestConfig | undefined)
      : undefined;
    if (!config) throw error;

    if (error.status === 401 && !config.skipAuth) {
      if (error.code === 'token_expired' && !config._authRetried) {
        const token = await deps.tokens.refresh();
        if (!token) throw error;
        config._authRetried = true;
        return instance.request(config);
      }
      if (FORCED_LOGOUT_CODES.has(error.code)) {
        deps.tokens.forceLogout(
          error.code === 'session_revoked' ? 'session_revoked' : 'token_invalid',
        );
      } else if (error.code === 'not_authenticated' && deps.tokens.hasSession()) {
        deps.tokens.forceLogout('not_authenticated');
      }
      throw error;
    }

    const attempt = config._retryCount ?? 0;
    const maxRetries = config.maxRetries ?? 2;
    if (attempt < maxRetries && isIdempotent(config)) {
      const delay = retryDelayMs(error, attempt, random);
      if (delay !== null) {
        config._retryCount = attempt + 1;
        await sleep(delay);
        if (config.signal && 'aborted' in config.signal && config.signal.aborted) {
          throw new ApiError({ status: 0, code: 'cancelled', message: 'Request cancelled' });
        }
        return instance.request(config);
      }
    }
    throw error;
  });

  return instance;
}
