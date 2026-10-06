import { Router } from 'express';
import { z } from 'zod';
import { users, toPublicUser } from '../db/users.js';
import { authedUser, requireAuth } from '../auth/middleware.js';
import { HttpError, parse } from '../utils/http.js';
import { isOnline } from '../realtime/presence.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get('/search', (req, res) => {
  const q = parse(z.string().trim().max(40).default(''), req.query.q);
  if (q.length < 1) {
    res.json({ users: [] });
    return;
  }
  const me = authedUser(req);
  const found = users.search(me.id, q).map((u) => ({ ...toPublicUser(u), online: isOnline(u.id) }));
  res.json({ users: found });
});

usersRouter.get('/:id', (req, res) => {
  const user = users.findById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');
  res.json({ user: { ...toPublicUser(user), online: isOnline(user.id) } });
});
