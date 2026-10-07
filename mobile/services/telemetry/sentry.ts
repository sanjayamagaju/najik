import * as Sentry from '@sentry/react-native';
import * as Application from 'expo-application';

import type { AppConfig } from '@/config/env';

import { scrubRecord, scrubString, scrubUrl, scrubValue } from './scrub';
import { configureTelemetry } from './telemetry';

let initialized = false;

/** Initializes Sentry when a DSN is configured; otherwise monitoring stays fully disabled. */
export function initMonitoring(config: AppConfig): void {
  if (initialized) return;
  initialized = true;
  if (!config.sentryDsn) {
    configureTelemetry({ sentryEnabled: false });
    return;
  }
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.appEnv,
    release: `najik@${Application.nativeApplicationVersion ?? '0.0.0'}+${Application.nativeBuildVersion ?? '0'}`,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableAutoSessionTracking: true,
    tracesSampleRate: config.appEnv === 'production' ? 0.1 : 1,
    beforeBreadcrumb(breadcrumb) {
      // Console breadcrumbs could contain anything; HTTP breadcrumbs keep method/status/path only.
      if (breadcrumb.category === 'console') return null;
      if (breadcrumb.category === 'xhr' || breadcrumb.category === 'fetch') {
        const data = breadcrumb.data ?? {};
        return {
          ...breadcrumb,
          data: {
            method: data.method,
            status_code: data.status_code,
            url: typeof data.url === 'string' ? scrubUrl(data.url) : undefined,
          },
        };
      }
      return {
        ...breadcrumb,
        message: breadcrumb.message ? scrubString(breadcrumb.message) : breadcrumb.message,
        data: scrubRecord(breadcrumb.data),
      };
    },
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
        if (event.request.url) event.request.url = scrubUrl(event.request.url);
      }
      event.user = event.user?.id ? { id: event.user.id } : undefined;
      event.extra = scrubRecord(event.extra);
      if (event.contexts) event.contexts = scrubValue(event.contexts) as typeof event.contexts;
      if (event.message) event.message = scrubString(event.message);
      event.exception?.values?.forEach((value) => {
        if (value.value) value.value = scrubString(value.value);
      });
      return event;
    },
  });
  configureTelemetry({ sentryEnabled: true });
}

export const wrapRoot = Sentry.wrap;
