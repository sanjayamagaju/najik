import { telemetry } from '@/services/telemetry';
import type { Tokens } from '@/types/protocol';

import { ApiError, normalizeError } from './errors';

export type ForcedLogoutReason =
  'token_invalid' | 'session_revoked' | 'refresh_rejected' | 'ws_4004' | 'not_authenticated';

export interface TokenStorage {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

export interface TokenManagerDeps {
  storage: TokenStorage;
  /** Performs POST /auth/refresh without auth interceptors. Must throw ApiError-compatible errors. */
  refreshRequest: (refreshToken: string) => Promise<Tokens>;
  now?: () => number;
  /** Refresh proactively when the access token expires within this window. */
  proactiveSkewMs?: number;
}

/**
 * Owns the access/refresh token pair for the whole app (REST *and* WebSocket).
 *
 * - Proactive refresh: `getValidAccessToken()` refreshes when the token is about to expire.
 * - Reactive refresh: the API client calls `refresh()` on 401 `token_expired`.
 * - Single-flight: concurrent callers share one in-flight refresh. Refresh tokens rotate and
 *   reuse revokes the session (PROTOCOL §3), so two parallel refreshes would log the user out.
 */
export class TokenManager {
  private tokens: Tokens | null = null;
  private inflight: Promise<string | null> | null = null;
  private forcedLogoutHandler: ((reason: ForcedLogoutReason) => void) | null = null;
  private readonly listeners = new Set<(tokens: Tokens) => void>();
  private readonly now: () => number;
  private readonly skewMs: number;

  constructor(private readonly deps: TokenManagerDeps) {
    this.now = deps.now ?? Date.now;
    this.skewMs = deps.proactiveSkewMs ?? 60_000;
  }

  setForcedLogoutHandler(handler: (reason: ForcedLogoutReason) => void): void {
    this.forcedLogoutHandler = handler;
  }

  /** Notified after every successful refresh (e.g. to re-auth the open WebSocket). */
  onTokensRefreshed(listener: (tokens: Tokens) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async hydrate(): Promise<Tokens | null> {
    this.tokens = await this.deps.storage.load();
    if (this.tokens && Date.parse(this.tokens.refresh_expires_at) <= this.now()) {
      await this.clear();
    }
    return this.tokens;
  }

  async setTokens(tokens: Tokens): Promise<void> {
    this.tokens = tokens;
    await this.deps.storage.save(tokens);
  }

  async clear(): Promise<void> {
    this.tokens = null;
    await this.deps.storage.clear();
  }

  hasSession(): boolean {
    return this.tokens !== null;
  }

  getAccessTokenSync(): string | null {
    return this.tokens?.access ?? null;
  }

  isAccessExpiringSoon(): boolean {
    if (!this.tokens) return false;
    const expiresAt = Date.parse(this.tokens.access_expires_at);
    return Number.isNaN(expiresAt) || expiresAt - this.now() <= this.skewMs;
  }

  /** Returns an access token that is valid for at least `proactiveSkewMs`, refreshing if needed. */
  async getValidAccessToken(): Promise<string | null> {
    if (!this.tokens) return null;
    if (this.inflight) return this.inflight;
    if (this.isAccessExpiringSoon()) return this.refresh();
    return this.tokens.access;
  }

  /** Signals a forced logout (e.g. 401 token_invalid / session_revoked, WS 4004). */
  forceLogout(reason: ForcedLogoutReason): void {
    if (!this.tokens && reason !== 'ws_4004') return;
    telemetry.warn('auth', 'forced logout', { reason });
    this.tokens = null;
    void this.deps.storage.clear();
    this.forcedLogoutHandler?.(reason);
  }

  /**
   * Single-flight refresh. Resolves with the new access token, or null when the session is
   * gone (in which case a forced logout was triggered). Network errors are rethrown so the
   * caller can retry later without logging the user out.
   */
  refresh(): Promise<string | null> {
    if (this.inflight) return this.inflight;
    const current = this.tokens;
    if (!current) return Promise.resolve(null);

    this.inflight = (async () => {
      try {
        // Rotation is strict (reuse revokes the session), so never present a refresh token that
        // may already have been rotated: if storage holds a newer pair (e.g. written after a
        // previous attempt or by a background task), adopt it instead of refreshing again.
        const stored = await this.deps.storage.load();
        if (
          stored &&
          stored.refresh !== current.refresh &&
          Date.parse(stored.access_expires_at) > this.now()
        ) {
          this.tokens = stored;
          return stored.access;
        }
        const next = await this.deps.refreshRequest(current.refresh);
        // The user may have logged out while the request was in flight.
        if (this.tokens?.refresh !== current.refresh) return this.tokens?.access ?? null;
        await this.setTokens(next);
        telemetry.breadcrumb('auth', 'token refreshed');
        for (const listener of this.listeners) listener(next);
        return next.access;
      } catch (error) {
        const apiError: ApiError = normalizeError(error);
        if (apiError.status === 401 || apiError.status === 400 || apiError.status === 403) {
          this.forceLogout('refresh_rejected');
          return null;
        }
        throw apiError;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}
