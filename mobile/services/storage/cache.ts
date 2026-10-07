import AsyncStorage from '@react-native-async-storage/async-storage';

import { telemetry } from '@/services/telemetry';

/**
 * Versioned, crash-safe AsyncStorage cache for NON-SENSITIVE data only.
 * Tokens never go here (see secureTokenStore).
 *
 * Every entry is wrapped in an envelope with a schema version and the owning user id, so:
 *  - a schema change (bumped `version`) discards stale data instead of crashing on it,
 *  - a different signed-in user never sees the previous user's cache,
 *  - corrupt JSON or a failing validator yields `null` rather than throwing.
 */
export const CACHE_PREFIX = 'najik.cache.';
/** Device-scoped preferences (theme, haptics) survive sign-out; user caches do not. */
export const DEVICE_PREFIX = 'najik.device.';

interface Envelope {
  v: number;
  owner: string | null;
  savedAt: string;
  data: unknown;
}

export function safeJsonParse(raw: string | null | undefined): unknown {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.v === 'number' && 'data' in v && (v.owner === null || typeof v.owner === 'string')
  );
}

export interface CacheOptions<T> {
  /** Key suffix; stored as `najik.cache.<key>`. */
  key: string;
  version: number;
  /** Returns the validated value, or null when the data does not match the current schema. */
  parse: (data: unknown) => T | null;
  /** 'user' entries are wiped on sign-out (default); 'device' entries persist. */
  scope?: 'user' | 'device';
}

export interface VersionedCache<T> {
  readonly storageKey: string;
  read(owner: string | null): Promise<T | null>;
  write(data: T, owner: string | null): Promise<void>;
  clear(): Promise<void>;
}

export function createCache<T>({
  key,
  version,
  parse,
  scope = 'user',
}: CacheOptions<T>): VersionedCache<T> {
  const storageKey = `${scope === 'user' ? CACHE_PREFIX : DEVICE_PREFIX}${key}`;
  return {
    storageKey,
    async read(owner) {
      try {
        const envelope = safeJsonParse(await AsyncStorage.getItem(storageKey));
        if (envelope === undefined) return null;
        if (!isEnvelope(envelope) || envelope.v !== version || envelope.owner !== owner) {
          await AsyncStorage.removeItem(storageKey);
          return null;
        }
        const parsed = parse(envelope.data);
        if (parsed === null) {
          telemetry.warn('cache', 'discarding invalid cache entry', { key });
          await AsyncStorage.removeItem(storageKey);
        }
        return parsed;
      } catch (error) {
        telemetry.warn('cache', 'cache read failed', { key, error: String(error) });
        return null;
      }
    },
    async write(data, owner) {
      const envelope: Envelope = { v: version, owner, savedAt: new Date().toISOString(), data };
      try {
        await AsyncStorage.setItem(storageKey, JSON.stringify(envelope));
      } catch (error) {
        telemetry.warn('cache', 'cache write failed', { key, error: String(error) });
      }
    },
    async clear() {
      try {
        await AsyncStorage.removeItem(storageKey);
      } catch (error) {
        telemetry.warn('cache', 'cache clear failed', { key, error: String(error) });
      }
    },
  };
}

/** Removes every user-scoped cache entry (called on logout / forced logout). */
export async function clearAllCaches(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    if (ours.length > 0) await AsyncStorage.multiRemove(ours);
  } catch (error) {
    telemetry.warn('cache', 'clear all failed', { error: String(error) });
  }
}

/** Small debounced writer so hot paths (typing, receipts) don't hammer AsyncStorage. */
export function createDebouncedWriter(fn: () => void | Promise<void>, delayMs = 400) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    void Promise.resolve()
      .then(fn)
      .catch((error: unknown) =>
        telemetry.warn('cache', 'debounced write failed', { error: String(error) }),
      );
  };
  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, delayMs);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        run();
      }
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
