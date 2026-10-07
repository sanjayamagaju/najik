import { useEffect, useState } from 'react';

import { usePresenceStore } from '@/store/presenceStore';
import type { Presence } from '@/types/protocol';
import { formatLastSeen } from '@/utils/date';

export function usePresence(userId: string | undefined): Presence | undefined {
  return usePresenceStore((s) => (userId ? s.byUserId[userId] : undefined));
}

export function useIsOnline(userId: string | undefined): boolean {
  return usePresenceStore((s) => (userId ? s.byUserId[userId]?.online === true : false));
}

/** Re-renders every `intervalMs` so relative labels ("5 min ago") stay fresh. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** "Online" or "last seen …"; null when presence is unknown. */
export function presenceLabel(presence: Presence | undefined, now: Date): string | null {
  if (!presence) return null;
  if (presence.online) return 'Online';
  return formatLastSeen(presence.last_seen_at, now);
}
