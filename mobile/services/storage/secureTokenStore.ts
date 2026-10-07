import * as SecureStore from 'expo-secure-store';

import { telemetry } from '@/services/telemetry';
import type { Tokens } from '@/types/protocol';

import { safeJsonParse } from './cache';

/**
 * Tokens live only in the Keychain / Keystore. AFTER_FIRST_UNLOCK lets background push
 * handling (and phase-2 VoIP pushes) read the access token while the device is locked.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

const TOKENS_KEY = 'najik.auth.tokens.v1';

export function isTokens(value: unknown): value is Tokens {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.access === 'string' &&
    typeof v.refresh === 'string' &&
    typeof v.access_expires_at === 'string' &&
    typeof v.refresh_expires_at === 'string'
  );
}

export const secureTokenStore = {
  async load(): Promise<Tokens | null> {
    try {
      const parsed = safeJsonParse(await SecureStore.getItemAsync(TOKENS_KEY, OPTIONS));
      if (parsed === undefined) return null;
      if (!isTokens(parsed)) {
        await SecureStore.deleteItemAsync(TOKENS_KEY, OPTIONS);
        return null;
      }
      return parsed;
    } catch (error) {
      telemetry.warn('secure-store', 'token load failed', { error: String(error) });
      return null;
    }
  },
  async save(tokens: Tokens): Promise<void> {
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens), OPTIONS);
  },
  async clear(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(TOKENS_KEY, OPTIONS);
    } catch (error) {
      telemetry.warn('secure-store', 'token clear failed', { error: String(error) });
    }
  },
};
