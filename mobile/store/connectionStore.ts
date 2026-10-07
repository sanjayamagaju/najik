import { create } from 'zustand';

import type { WsState } from '@/services/websocket/WsClient';

interface ConnectionState {
  wsState: WsState;
  networkAvailable: boolean;
  /** True after the first successful auth this session — avoids flashing "Connecting…" at cold start. */
  everConnected: boolean;
  setWsState: (state: WsState) => void;
  setNetworkAvailable: (available: boolean) => void;
  reset: () => void;
}

export const useConnectionStore = create<ConnectionState>()((set) => ({
  wsState: 'idle',
  networkAvailable: true,
  everConnected: false,
  setWsState: (wsState) =>
    set((s) => ({ wsState, everConnected: s.everConnected || wsState === 'open' })),
  setNetworkAvailable: (networkAvailable) => set({ networkAvailable }),
  reset: () => set({ wsState: 'idle', everConnected: false }),
}));

export type ConnectionBanner = 'offline' | 'connecting' | 'online' | null;

/** What the connection banner should show. `online` is shown briefly after a recovery. */
export function deriveConnectionBanner(
  wsState: WsState,
  networkAvailable: boolean,
): ConnectionBanner {
  if (!networkAvailable || wsState === 'offline') return 'offline';
  if (wsState === 'open') return 'online';
  if (wsState === 'stopped' || wsState === 'idle') return null;
  return 'connecting';
}
