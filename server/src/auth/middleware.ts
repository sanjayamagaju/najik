import type { NextFunction, Request, Response } from 'express';
import type { UserRow } from '../db/users.js';
import { bearerFrom, verifyToken } from './tokens.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserRow;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = verifyToken(bearerFrom(req.headers.authorization));
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.user = user;
  next();
}

/** Narrowing helper for handlers mounted behind `requireAuth`. */
export function authedUser(req: Request): UserRow {
  if (!req.user) throw new Error('requireAuth middleware missing');
  return req.user;
}
