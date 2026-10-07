import * as Sentry from '@sentry/react-native';

import { scrubRecord, scrubString } from './scrub';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

type LogData = Record<string, unknown>;

interface TelemetryState {
  minLevel: LogLevel;
  consoleEnabled: boolean;
  sentryEnabled: boolean;
}

const state: TelemetryState = {
  minLevel: __DEV__ ? 'debug' : 'info',
  consoleEnabled: __DEV__ && process.env.NODE_ENV !== 'test',
  sentryEnabled: false,
};

export function configureTelemetry(options: Partial<TelemetryState>): void {
  Object.assign(state, options);
}

function emit(level: LogLevel, scope: string, message: string, data?: LogData): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[state.minLevel]) return;
  const safeData = scrubRecord(data);
  const safeMessage = scrubString(message);
  if (state.consoleEnabled) {
    const line = `[${scope}] ${safeMessage}`;
    const args: unknown[] = safeData ? [line, safeData] : [line];
    if (level === 'error') console.error(...args);
    else if (level === 'warn') console.warn(...args);
    else console.log(...args);
  }
  if (state.sentryEnabled && level !== 'debug') {
    Sentry.addBreadcrumb({
      category: scope,
      message: safeMessage,
      level: level === 'warn' ? 'warning' : level,
      data: safeData,
    });
  }
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : 'Non-error thrown');
}

/**
 * The only logging API used by app code (console is lint-banned elsewhere).
 * Never pass message bodies, tokens or other PII; values are scrubbed defensively anyway.
 */
export const telemetry = {
  debug: (scope: string, message: string, data?: LogData) => emit('debug', scope, message, data),
  info: (scope: string, message: string, data?: LogData) => emit('info', scope, message, data),
  warn: (scope: string, message: string, data?: LogData) => emit('warn', scope, message, data),
  error(scope: string, message: string, error?: unknown, data?: LogData): void {
    emit('error', scope, message, {
      ...data,
      error: error instanceof Error ? error.message : error,
    });
    if (state.sentryEnabled && error !== undefined) {
      Sentry.captureException(toError(error), {
        tags: { scope },
        extra: scrubRecord({ ...data, message }),
      });
    }
  },
  breadcrumb(category: string, message: string, data?: LogData): void {
    if (state.consoleEnabled && state.minLevel === 'debug') {
      console.log(`[${category}] ${message}`, scrubRecord(data) ?? '');
    }
    if (state.sentryEnabled) {
      Sentry.addBreadcrumb({ category, message, level: 'info', data: scrubRecord(data) });
    }
  },
  captureException(error: unknown, context?: LogData): void {
    if (state.consoleEnabled) console.error(error);
    if (state.sentryEnabled) {
      Sentry.captureException(toError(error), { extra: scrubRecord(context) });
    }
  },
  setUser(userId: string | null): void {
    // Only the opaque user id is attached — never username, email or display name.
    if (state.sentryEnabled) Sentry.setUser(userId ? { id: userId } : null);
  },
};
