import { type AxiosError, isAxiosError, isCancel } from 'axios';

import type { ApiErrorBody, ApiErrorCode } from '@/types/protocol';

/** Normalized error for every REST failure, mirroring PROTOCOL §1 plus client-side codes. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | (string & {});
  readonly details: Record<string, string[]>;
  readonly retryAfterSec: number | null;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    details?: Record<string, string[]>;
    retryAfterSec?: number | null;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code;
    this.details = params.details ?? {};
    this.retryAfterSec = params.retryAfterSec ?? null;
  }

  get isNetwork(): boolean {
    return this.code === 'network_error' || this.code === 'timeout';
  }

  /** First message for a form field (validation_error details). */
  fieldError(field: string): string | undefined {
    return this.details[field]?.[0];
  }
}

export const FORCED_LOGOUT_CODES = new Set(['token_invalid', 'session_revoked']);

function isApiErrorBody(data: unknown): data is ApiErrorBody {
  if (!data || typeof data !== 'object') return false;
  const err = (data as { error?: unknown }).error;
  return (
    !!err &&
    typeof err === 'object' &&
    typeof (err as { code?: unknown }).code === 'string' &&
    typeof (err as { message?: unknown }).message === 'string'
  );
}

function parseRetryAfter(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(String(value));
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function defaultCodeForStatus(status: number): ApiErrorCode {
  if (status === 400) return 'validation_error';
  if (status === 401) return 'not_authenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (isCancel(error)) {
    return new ApiError({ status: 0, code: 'cancelled', message: 'Request cancelled' });
  }
  if (isAxiosError(error)) {
    const axiosError = error as AxiosError<unknown>;
    if (axiosError.code === 'ERR_CANCELED') {
      return new ApiError({ status: 0, code: 'cancelled', message: 'Request cancelled' });
    }
    const response = axiosError.response;
    if (!response) {
      const timedOut = axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT';
      return new ApiError({
        status: 0,
        code: timedOut ? 'timeout' : 'network_error',
        message: timedOut ? 'The request timed out' : 'Network unavailable',
      });
    }
    const retryAfterSec = parseRetryAfter(
      (response.headers as Record<string, unknown> | undefined)?.['retry-after'],
    );
    if (isApiErrorBody(response.data)) {
      return new ApiError({
        status: response.status,
        code: response.data.error.code,
        message: response.data.error.message,
        details: response.data.error.details,
        retryAfterSec,
      });
    }
    return new ApiError({
      status: response.status,
      code: defaultCodeForStatus(response.status),
      message: `Request failed (${response.status})`,
      retryAfterSec,
    });
  }
  return new ApiError({
    status: 0,
    code: 'unknown',
    message: error instanceof Error ? error.message : 'Unexpected error',
  });
}

/** User-facing copy for an error; never exposes internals. */
export function describeError(error: unknown): string {
  const e = normalizeError(error);
  switch (e.code) {
    case 'network_error':
      return "You're offline. Check your connection and try again.";
    case 'timeout':
      return 'The server took too long to respond. Please try again.';
    case 'rate_limited':
      return e.retryAfterSec
        ? `Slow down a little — try again in ${Math.ceil(e.retryAfterSec)}s.`
        : 'Slow down a little and try again shortly.';
    case 'server_error':
      return 'Something went wrong on our side. Please try again.';
    case 'cancelled':
      return 'Cancelled.';
    default:
      return e.message || 'Something went wrong.';
  }
}
