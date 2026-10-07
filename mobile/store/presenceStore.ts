import { create } from 'zustand';

import type { Presence } from '@/types/protocol';

interface PresenceState {
  byUserId: Record<string, Presence>;
  set: (presence: Presence) => void;
  setMany: (presences: Presence[]) => void;
  /** Our socket is down: nobody can be confirmed online any more. */
  markAllUnknown: () => void;
  reset: () => void;
}

function same(a: Presence | undefined, b: Presence): boolean {
  return !!a && a.online === b.online && a.last_seen_at === b.last_seen_at;
}

export const usePresenceStore = create<PresenceState>()((set) => ({
  byUserId: {},
  set: (presence) =>
    set((state) =>
      same(state.byUserId[presence.user_id], presence)
        ? state
        : { byUserId: { ...state.byUserId, [presence.user_id]: presence } },
    ),
  setMany: (presences) =>
    set((state) => {
      let byUserId = state.byUserId;
      for (const p of presences) {
        if (same(byUserId[p.user_id], p)) continue;
        if (byUserId === state.byUserId) byUserId = { ...byUserId };
        byUserId[p.user_id] = p;
      }
      return byUserId === state.byUserId ? state : { byUserId };
    }),
  markAllUnknown: () =>
    set((state) => {
      const entries = Object.entries(state.byUserId);
      if (!entries.some(([, p]) => p.online)) return state;
      return {
        byUserId: Object.fromEntries(entries.map(([id, p]) => [id, { ...p, online: false }])),
      };
    }),
  reset: () => set({ byUserId: {} }),
}));
