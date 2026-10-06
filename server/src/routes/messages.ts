import { Router } from 'express';
import { z } from 'zod';
import { messages } from '../db/messages.js';
import { users, toPublicUser } from '../db/users.js';
import { authedUser, requireAuth } from '../auth/middleware.js';
import { HttpError, parse } from '../utils/http.js';
import { isOnline } from '../realtime/presence.js';

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

/** Conversation list: one entry per peer with the latest message and unread count. */
messagesRouter.get('/conversations', (req, res) => {
  const me = authedUser(req);
  const list = messages.conversations(me.id).flatMap((c) => {
    const peer = users.findById(c.peerId);
    if (!peer) return [];
    return [{ ...c, peer: { ...toPublicUser(peer), online: isOnline(peer.id) } }];
  });
  res.json({ conversations: list });
});

const historyQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  beforeId: z.string().max(64).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

messagesRouter.get('/with/:peerId', (req, res) => {
  const me = authedUser(req);
  const peerId = req.params.peerId;
  if (!users.findById(peerId)) throw new HttpError(404, 'User not found');
  const { before, beforeId, limit } = parse(historyQuery, req.query);
  const list = messages.history(me.id, peerId, before ?? Date.now() + 1, beforeId, limit + 1);
  const hasMore = list.length > limit;
  res.json({ messages: hasMore ? list.slice(1) : list, hasMore });
});
