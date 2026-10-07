import { create } from 'zustand';

import { createCache } from '@/services/storage/cache';

const MAX_RECENT = 32;

const recentCache = createCache<string[]>({
  key: 'emoji.recent',
  version: 1,
  scope: 'device',
  parse: (d) =>
    Array.isArray(d)
      ? d.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT)
      : null,
});

interface RecentEmojiState {
  recent: string[];
  loaded: boolean;
  load: () => Promise<void>;
  remember: (emoji: string) => void;
}

export const useRecentEmoji = create<RecentEmojiState>()((set, get) => ({
  recent: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    const recent = (await recentCache.read(null)) ?? [];
    set({ recent, loaded: true });
  },
  remember: (emoji) => {
    const recent = [emoji, ...get().recent.filter((e) => e !== emoji)].slice(0, MAX_RECENT);
    set({ recent });
    void recentCache.write(recent, null);
  },
}));
