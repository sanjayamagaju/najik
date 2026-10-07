/**
 * PII / secret scrubbing for anything that leaves the device (Sentry events, breadcrumbs, logs).
 * Rule: tokens, passwords and message content NEVER leave the device.
 */
const SENSITIVE_KEY =
  /^(authorization|cookie|set-cookie|token|access|refresh|access_token|refresh_token|password|current_password|new_password|body|preview|sdp|candidate|credential|email|q|sender_name|display_name|username)$/i;

export const REDACTED = '[redacted]';

const JWT_LIKE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

export function scrubString(value: string): string {
  return value.replace(BEARER, `Bearer ${REDACTED}`).replace(JWT_LIKE, REDACTED);
}

/** Removes query strings and fragments, which may carry search terms or identifiers. */
export function scrubUrl(url: string): string {
  const idx = url.search(/[?#]/);
  return scrubString(idx === -1 ? url : url.slice(0, idx));
}

export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) {
        out[key] = REDACTED;
      } else if (key === 'url' && typeof v === 'string') {
        out[key] = scrubUrl(v);
      } else {
        out[key] = scrubValue(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function scrubRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return value ? (scrubValue(value) as Record<string, unknown>) : undefined;
}
