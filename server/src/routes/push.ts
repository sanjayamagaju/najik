import { Router } from 'express';
import { z } from 'zod';
import { pushTokens } from '../db/pushTokens.js';
import { authedUser, requireAuth } from '../auth/middleware.js';
import { parse } from '../utils/http.js';
import { pushEnabled } from '../push/fcm.js';

export const pushRouter = Router();
pushRouter.use(requireAuth);

const tokenSchema = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(['android']).default('android'),
});

pushRouter.post('/register', (req, res) => {
  const { token, platform } = parse(tokenSchema, req.body);
  pushTokens.register(authedUser(req).id, token, platform);
  res.json({ ok: true, enabled: pushEnabled() });
});

pushRouter.post('/unregister', (req, res) => {
  const { token } = parse(tokenSchema, req.body);
  pushTokens.unregister(authedUser(req).id, token);
  res.status(204).end();
});
