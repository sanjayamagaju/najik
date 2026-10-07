import axios, { type AxiosInstance } from 'axios';

import { getConfig } from '@/config/env';
import { secureTokenStore } from '@/services/storage/secureTokenStore';
import type { RefreshResponse } from '@/types/protocol';

import { createApiClient } from './client';
import { normalizeError } from './errors';
import { TokenManager } from './tokenManager';

/** The app-wide token owner, shared by the REST client and the WebSocket client. */
export const tokenManager = new TokenManager({
  storage: secureTokenStore,
  refreshRequest: async (refresh) => {
    try {
      const { data } = await axios.post<RefreshResponse>(
        `${getConfig().apiBaseUrl}/auth/refresh`,
        { refresh },
        { timeout: 15_000, headers: { 'Content-Type': 'application/json' } },
      );
      return data.tokens;
    } catch (error) {
      throw normalizeError(error);
    }
  },
});

let instance: AxiosInstance | null = null;

export function apiClient(): AxiosInstance {
  instance ??= createApiClient({ baseURL: getConfig().apiBaseUrl, tokens: tokenManager });
  return instance;
}
