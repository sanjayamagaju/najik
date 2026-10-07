import { create } from 'zustand';

import type { PublicUser } from '@/types/protocol';

export type ToastKind = 'info' | 'success' | 'error' | 'message' | 'ping';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
  /** Route to open when tapped (e.g. the chat a message toast belongs to). */
  conversationId?: string;
  avatar?: Pick<PublicUser, 'display_name' | 'avatar_color'>;
  durationMs: number;
}

export interface PingOverlayEvent {
  id: string;
  conversationId: string;
  from: Pick<PublicUser, 'id' | 'display_name' | 'avatar_color'>;
}

interface UiState {
  /** The chat currently on screen (notification suppression, unread logic). */
  activeConversationId: string | null;
  appActive: boolean;
  toasts: Toast[];
  pingOverlay: PingOverlayEvent | null;
  /** conversationId → epoch ms until which the ping button is cooling down. */
  pingCooldownUntil: Record<string, number>;
  setActiveConversation: (id: string | null) => void;
  setAppActive: (active: boolean) => void;
  showToast: (
    toast: Omit<Toast, 'id' | 'durationMs'> & { id?: string; durationMs?: number },
  ) => void;
  dismissToast: (id: string) => void;
  showPingOverlay: (event: PingOverlayEvent) => void;
  dismissPingOverlay: () => void;
  setPingCooldown: (conversationId: string, untilMs: number) => void;
  reset: () => void;
}

let toastCounter = 0;
const MAX_TOASTS = 3;

export const useUiStore = create<UiState>()((set) => ({
  activeConversationId: null,
  appActive: true,
  toasts: [],
  pingOverlay: null,
  pingCooldownUntil: {},
  setActiveConversation: (activeConversationId) => set({ activeConversationId }),
  setAppActive: (appActive) => set({ appActive }),
  showToast: (toast) =>
    set((state) => {
      const id = toast.id ?? `toast-${++toastCounter}`;
      if (state.toasts.some((t) => t.id === id)) return state;
      const next: Toast = { durationMs: 3500, ...toast, id };
      return { toasts: [...state.toasts, next].slice(-MAX_TOASTS) };
    }),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  showPingOverlay: (pingOverlay) => set({ pingOverlay }),
  dismissPingOverlay: () => set({ pingOverlay: null }),
  setPingCooldown: (conversationId, untilMs) =>
    set((state) => ({
      pingCooldownUntil: { ...state.pingCooldownUntil, [conversationId]: untilMs },
    })),
  reset: () =>
    set({ activeConversationId: null, toasts: [], pingOverlay: null, pingCooldownUntil: {} }),
}));

export const toast = {
  info: (title: string, body?: string) =>
    useUiStore.getState().showToast({ kind: 'info', title, body }),
  success: (title: string, body?: string) =>
    useUiStore.getState().showToast({ kind: 'success', title, body }),
  error: (title: string, body?: string) =>
    useUiStore.getState().showToast({ kind: 'error', title, body, durationMs: 4500 }),
};
