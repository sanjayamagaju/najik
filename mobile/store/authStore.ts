import { create } from 'zustand';

import type { Me } from '@/types/protocol';

export type AuthStatus = 'hydrating' | 'signedOut' | 'signedIn';

export type SignOutReason = 'user' | 'forced' | 'account_deleted';

interface AuthState {
  status: AuthStatus;
  user: Me | null;
  /** Set when the last sign-out was forced (revoked session) so the login screen can explain. */
  lastSignOutReason: SignOutReason | null;
  setSignedIn: (user: Me) => void;
  setUser: (user: Me) => void;
  setSignedOut: (reason: SignOutReason | null) => void;
  clearSignOutReason: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: 'hydrating',
  user: null,
  lastSignOutReason: null,
  setSignedIn: (user) => set({ status: 'signedIn', user, lastSignOutReason: null }),
  setUser: (user) => set({ user }),
  setSignedOut: (reason) => set({ status: 'signedOut', user: null, lastSignOutReason: reason }),
  clearSignOutReason: () => set({ lastSignOutReason: null }),
}));

export const selectMyUserId = (s: AuthState) => s.user?.id ?? null;

export function getMyUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}
