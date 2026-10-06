/** In-memory presence: userId → set of connected socket ids. */
const sockets = new Map<string, Set<string>>();

/** Returns true if this is the user's first live connection. */
export function addSocket(userId: string, socketId: string): boolean {
  let set = sockets.get(userId);
  const first = !set || set.size === 0;
  if (!set) {
    set = new Set();
    sockets.set(userId, set);
  }
  set.add(socketId);
  return first;
}

/** Returns true if the user has no live connections left. */
export function removeSocket(userId: string, socketId: string): boolean {
  const set = sockets.get(userId);
  if (!set) return true;
  set.delete(socketId);
  if (set.size === 0) {
    sockets.delete(userId);
    return true;
  }
  return false;
}

export function isOnline(userId: string): boolean {
  return (sockets.get(userId)?.size ?? 0) > 0;
}
