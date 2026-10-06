import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { users, toPublicUser } from '../db/users.js';
import { pushTokens } from '../db/pushTokens.js';
import { signToken } from '../auth/tokens.js';
import { authedUser, requireAuth } from '../auth/middleware.js';
import { HttpError, parse } from '../utils/http.js';
import { disconnectUser } from '../realtime/index.js';
import { endCallOf } from '../realtime/calls.js';

const username = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(24, 'Username must be at most 24 characters')
  .regex(/^[a-zA-Z0-9_.]+$/, 'Username may contain letters, numbers, "_" and "."');

const registerSchema = z.object({
  username,
  displayName: z.string().trim().min(1, 'Display name is required').max(40, 'Display name is too long'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password is too long'),
});

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(24),
  password: z.string().min(1, 'Password is required').max(128),
});

// Brute-force protection on credential endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // Only failed attempts count, so many users behind one carrier-NAT IP aren't locked out.
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts. Please try again later.' },
});

// Pre-computed hash so unknown usernames take the same time as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync('najik-timing-equaliser', 12);

export const authRouter = Router();

authRouter.post('/register', authLimiter, async (req, res) => {
  const input = parse(registerSchema, req.body);
  if (users.findByUsername(input.username)) throw new HttpError(409, 'That username is taken');
  const passwordHash = await bcrypt.hash(input.password, 12);
  let user;
  try {
    user = users.create({ username: input.username, displayName: input.displayName, passwordHash });
  } catch (err) {
    // Two sign-ups racing for the same name: the unique index decides.
    if (String((err as Error).message).includes('UNIQUE constraint failed: users.username')) {
      throw new HttpError(409, 'That username is taken');
    }
    throw err;
  }
  res.status(201).json({ token: signToken(user), user: toPublicUser(user) });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const input = parse(loginSchema, req.body);
  const user = users.findByUsername(input.username);
  const ok = await bcrypt.compare(input.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Invalid username or password');
  res.json({ token: signToken(user), user: toPublicUser(user) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(authedUser(req)) });
});

authRouter.post('/logout', requireAuth, (req, res) => {
  const user = authedUser(req);
  // Logout signs out every device, so none of them should keep ringing.
  users.revokeTokens(user.id);
  pushTokens.removeAllForUser(user.id);
  endCallOf(user.id);
  disconnectUser(user.id);
  res.status(204).end();
});
