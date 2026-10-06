import { db } from './index.js';

/** A user may keep several devices; each FCM token belongs to exactly one user. */
const MAX_TOKENS_PER_USER = 10;

const stmts = {
  upsert: db.prepare(
    `INSERT INTO push_tokens (token, user_id, platform, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, updated_at = excluded.updated_at`,
  ),
  forUser: db.prepare('SELECT token FROM push_tokens WHERE user_id = ? ORDER BY updated_at DESC'),
  trim: db.prepare(
    `DELETE FROM push_tokens WHERE user_id = ? AND token NOT IN
       (SELECT token FROM push_tokens WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?)`,
  ),
  remove: db.prepare('DELETE FROM push_tokens WHERE token = ? AND user_id = ?'),
  removeAny: db.prepare('DELETE FROM push_tokens WHERE token = ?'),
  removeUser: db.prepare('DELETE FROM push_tokens WHERE user_id = ?'),
};

export const pushTokens = {
  register(userId: string, token: string, platform: 'android'): void {
    stmts.upsert.run(token, userId, platform, Date.now());
    stmts.trim.run(userId, userId, MAX_TOKENS_PER_USER);
  },

  forUser(userId: string): string[] {
    return (stmts.forUser.all(userId) as unknown as { token: string }[]).map((r) => r.token);
  },

  hasAny(userId: string): boolean {
    return this.forUser(userId).length > 0;
  },

  unregister(userId: string, token: string): void {
    stmts.remove.run(token, userId);
  },

  /** Drop tokens FCM reported as dead. */
  purge(tokens: string[]): void {
    for (const t of tokens) stmts.removeAny.run(t);
  },

  removeAllForUser(userId: string): void {
    stmts.removeUser.run(userId);
  },
};
