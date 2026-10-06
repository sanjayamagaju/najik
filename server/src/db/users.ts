import { randomUUID } from 'node:crypto';
import { db } from './index.js';

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  avatar_hue: number;
  token_version: number;
  created_at: number;
  last_seen: number | null;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarHue: number;
  lastSeen: number | null;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarHue: row.avatar_hue,
    lastSeen: row.last_seen,
  };
}

const stmts = {
  insert: db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, avatar_hue, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ),
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  byUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  search: db.prepare(
    `SELECT * FROM users
     WHERE id != ? AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
     ORDER BY (username = ?) DESC, username
     LIMIT 20`,
  ),
  touchLastSeen: db.prepare('UPDATE users SET last_seen = ? WHERE id = ?'),
  bumpTokenVersion: db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?'),
};

export const users = {
  create(input: { username: string; displayName: string; passwordHash: string }): UserRow {
    const id = randomUUID();
    const hue = Math.floor(Math.random() * 360);
    stmts.insert.run(id, input.username, input.displayName, input.passwordHash, hue, Date.now());
    return stmts.byId.get(id) as unknown as UserRow;
  },

  findById(id: string): UserRow | undefined {
    return stmts.byId.get(id) as unknown as UserRow | undefined;
  },

  findByUsername(username: string): UserRow | undefined {
    return stmts.byUsername.get(username) as unknown as UserRow | undefined;
  },

  search(selfId: string, query: string): UserRow[] {
    const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
    const like = `%${escaped}%`;
    return stmts.search.all(selfId, like, like, query) as unknown as UserRow[];
  },

  touchLastSeen(id: string, at = Date.now()): void {
    stmts.touchLastSeen.run(at, id);
  },

  /** Invalidates every token issued so far for this user (used on logout). */
  revokeTokens(id: string): void {
    stmts.bumpTokenVersion.run(id);
  },
};
