import { create } from 'zustand';
import { syncStatusBar } from '../lib/native';

const KEY = 'najik.theme';

function initialDark(): boolean {
  const saved = localStorage.getItem(KEY);
  if (saved) return saved === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(dark: boolean): void {
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0b14' : '#f4f3fa');
  void syncStatusBar(dark);
}

interface ThemeState {
  dark: boolean;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => {
  const dark = initialDark();
  apply(dark);
  return {
    dark,
    toggle() {
      const next = !get().dark;
      localStorage.setItem(KEY, next ? 'dark' : 'light');
      apply(next);
      set({ dark: next });
    },
  };
});
