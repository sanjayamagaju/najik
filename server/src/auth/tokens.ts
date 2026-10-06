import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { users, type UserRow } from '../db/users.js';

interface TokenPayload {
  sub: string;
  ver: number;
}

export function signToken(user: UserRow): string {
  const payload: TokenPayload = { sub: user.id, ver: user.token_version };
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    issuer: 'najik',
  });
}

/** Verifies a token and returns the live user row, or null if invalid/revoked. */
export function verifyToken(token: string | undefined | null): UserRow | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'najik',
    }) as unknown as TokenPayload;
    const user = users.findById(payload.sub);
    if (!user || user.token_version !== payload.ver) return null;
    return user;
  } catch {
    return null;
  }
}

export function bearerFrom(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
