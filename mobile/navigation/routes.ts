import type { Href } from 'expo-router';

import type { CallMedia } from '@/types/protocol';

/**
 * Route helpers so screens never hand-assemble paths.
 * Groups `(auth)`, `(app)` and `(tabs)` don't appear in URLs.
 */
export const routes = {
  chats: '/' as Href,
  settings: '/settings' as Href,
  login: '/login' as Href,
  register: '/register' as Href,
  newChat: '/new-chat' as Href,
  chat: (id: string): Href => ({ pathname: '/chat/[id]', params: { id } }) as Href,
  editProfile: '/account/profile' as Href,
  sessions: '/account/sessions' as Href,
  changePassword: '/account/password' as Href,
  deleteAccount: '/account/delete' as Href,
  /** Dials `peerId` (or shows the live call). See app/(app)/call/[peerId].tsx. */
  call: (peerId: string, media: CallMedia, conversationId?: string): Href =>
    ({
      pathname: '/call/[peerId]',
      params: { peerId, media, ...(conversationId ? { conversationId } : {}) },
    }) as Href,
} as const;

/** Deep links: `najik://chat/<conversation_id>` (scheme varies per APP_ENV). */
export function hrefFromPath(path: string | null): Href | null {
  if (!path) return null;
  const chat = /^\/?chat\/([0-9a-f-]{36})$/i.exec(path);
  if (chat?.[1]) return routes.chat(chat[1]);
  return null;
}
