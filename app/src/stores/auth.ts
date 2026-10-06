import { create } from 'zustand';
import { api, ApiError, setUnauthorizedHandler, tokenStore } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';
import { bindRealtime } from '../realtime/bindings';
import { disablePush, enablePush } from '../lib/push';
import { useChat } from './chat';
import { useCall } from './call';
import type { User } from '../types';

type Status = 'loading' | 'authed' | 'guest' | 'unreachable';

interface AuthState {
  status: Status;
  user: User | null;
  bootstrap: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, displayName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

let unbind: (() => void) | null = null;

export const useAuth = create<AuthState>((set, get) => {
  const startSession = (user: User) => {
    useChat.getState().init(user.id);
    const socket = connectSocket();
    unbind?.();
    unbind = bindRealtime(socket, { onUnauthorized: () => void endSession() });
    set({ status: 'authed', user });
    void useChat.getState().loadConversations().catch(() => {});
    void enablePush();
  };

  const endSession = async () => {
    useCall.getState().hangup();
    unbind?.();
    unbind = null;
    disconnectSocket();
    tokenStore.clear();
    useChat.getState().reset();
    set({ status: 'guest', user: null });
  };

  setUnauthorizedHandler(() => void endSession());

  return {
    status: 'loading',
    user: null,

    async bootstrap() {
      set({ status: 'loading' });
      if (!tokenStore.get()) {
        set({ status: 'guest' });
        return;
      }
      try {
        const { user } = await api<{ user: User }>('/auth/me');
        startSession(user);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await endSession();
        } else {
          // Server unreachable: keep the token and offer a retry.
          set({ status: 'unreachable' });
        }
      }
    },

    async login(username, password) {
      const { token, user } = await api<{ token: string; user: User }>('/auth/login', { body: { username, password } });
      tokenStore.set(token);
      startSession(user);
    },

    async register(username, displayName, password) {
      const { token, user } = await api<{ token: string; user: User }>('/auth/register', {
        body: { username, displayName, password },
      });
      tokenStore.set(token);
      startSession(user);
    },

    async logout() {
      if (get().status !== 'authed') return;
      await disablePush();
      await api('/auth/logout', { method: 'POST' }).catch(() => {});
      await endSession();
    },
  };
});
