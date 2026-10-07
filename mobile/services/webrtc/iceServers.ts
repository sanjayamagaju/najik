import type { IceServer } from '@/types/protocol';

/**
 * ICE server bookkeeping. TURN credentials use the TURN REST scheme
 * (`username = "<unix expiry>:<user id>"`), so the expiry is read from the username itself:
 * the call acks carry a plain array without `ttl_sec`.
 */

export interface RtcIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Earliest TURN credential expiry (epoch ms) in a server list, or null when none can expire. */
export function iceServersExpiry(servers: readonly IceServer[]): number | null {
  let earliest: number | null = null;
  for (const s of servers) {
    if (!s.username) continue;
    const head = s.username.split(':')[0];
    const seconds = head ? Number(head) : NaN;
    if (!Number.isFinite(seconds) || seconds <= 0) continue;
    const ms = seconds * 1000;
    earliest = earliest === null ? ms : Math.min(earliest, ms);
  }
  return earliest;
}

/** Stale = expiring within `marginMs` (default 5 min) — an ICE restart would fail to allocate. */
export function iceServersStale(
  servers: readonly IceServer[],
  nowMs: number,
  marginMs = 5 * 60_000,
): boolean {
  const expiry = iceServersExpiry(servers);
  return expiry !== null && expiry - marginMs <= nowMs;
}

export function toRtcIceServers(servers: readonly IceServer[]): RtcIceServer[] {
  return servers
    .filter((s) => Array.isArray(s.urls) && s.urls.length > 0)
    .map((s) => ({
      urls: [...s.urls],
      ...(s.username ? { username: s.username } : {}),
      ...(s.credential ? { credential: s.credential } : {}),
    }));
}

/** Holds the servers for the current call and refreshes them through `fetchFresh` when stale. */
export class IceServerStore {
  private servers: IceServer[] = [];

  constructor(
    private readonly fetchFresh: () => Promise<IceServer[]>,
    private readonly now: () => number = Date.now,
  ) {}

  set(servers: readonly IceServer[] | null | undefined): void {
    if (servers && servers.length > 0) this.servers = [...servers];
  }

  get(): IceServer[] {
    return this.servers;
  }

  isStale(): boolean {
    return this.servers.length === 0 || iceServersStale(this.servers, this.now());
  }

  /** Returns fresh servers (refetching if stale); keeps the old ones if the fetch fails. */
  async ensureFresh(): Promise<{ servers: IceServer[]; refreshed: boolean }> {
    if (!this.isStale()) return { servers: this.servers, refreshed: false };
    try {
      const fresh = await this.fetchFresh();
      if (fresh.length > 0) {
        this.servers = [...fresh];
        return { servers: this.servers, refreshed: true };
      }
    } catch {
      // keep what we have; the restart may still work over STUN/host candidates
    }
    return { servers: this.servers, refreshed: false };
  }

  clear(): void {
    this.servers = [];
  }
}
