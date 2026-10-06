import { Router } from 'express';
import { z } from 'zod';
import { authedUser, requireAuth } from '../auth/middleware.js';
import { HttpError, parse } from '../utils/http.js';
import { declineCall } from '../realtime/calls.js';

export const callsRouter = Router();
callsRouter.use(requireAuth);

/**
 * Decline a ringing call without opening the app — used by the "Decline"
 * button on the Android incoming-call notification.
 */
callsRouter.post('/:callId/decline', (req, res) => {
  const callId = parse(z.string().uuid(), req.params.callId);
  if (!declineCall(authedUser(req).id, callId)) throw new HttpError(404, 'Call is no longer ringing');
  res.status(204).end();
});
