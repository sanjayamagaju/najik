import { create } from 'zustand';
import type { User } from '../types';

export interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: 'info' | 'success' | 'error' | 'message' | 'ping';
  user?: User;
  onClick?: () => void;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>, ttlMs?: number) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(t, ttlMs = 3800) {
    const id = ++seq;
    set({ toasts: [...get().toasts.slice(-2), { ...t, id }] });
    window.setTimeout(() => get().dismiss(id), ttlMs);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export const toast = {
  info: (title: string, description?: string) => useToasts.getState().push({ title, description, tone: 'info' }),
  success: (title: string, description?: string) => useToasts.getState().push({ title, description, tone: 'success' }),
  error: (title: string, description?: string) => useToasts.getState().push({ title, description, tone: 'error' }, 5000),
};
