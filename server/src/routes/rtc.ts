import { Router } from 'express';
import { createHmac } from 'node:crypto';
import { env } from '../config/env.js';
import { authedUser, requireAuth } from '../auth/middleware.js';

export const rtcRouter = Router();
rtcRouter.use(requireAuth);

/**
 * ICE server configuration for WebRTC.
 * With TURN_SECRET set, issues short-lived credentials compatible with
 * coturn's `use-auth-secret` (TURN REST API), so no long-lived TURN password
 * ever ships inside the APK.
 */
rtcRouter.get('/ice', (req, res) => {
  const user = authedUser(req);
  const iceServers: RTCIceServerLike[] = [];

  if (env.STUN_URLS.length) iceServers.push({ urls: env.STUN_URLS });

  if (env.TURN_URLS.length) {
    if (env.TURN_SECRET) {
      const expiry = Math.floor(Date.now() / 1000) + env.TURN_TTL_SECONDS;
      const username = `${expiry}:${user.id}`;
      const credential = createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
      iceServers.push({ urls: env.TURN_URLS, username, credential });
    } else if (env.TURN_USERNAME && env.TURN_CREDENTIAL) {
      iceServers.push({ urls: env.TURN_URLS, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
    }
  }

  res.json({ iceServers, ttl: env.TURN_TTL_SECONDS });
});

interface RTCIceServerLike {
  urls: string[];
  username?: string;
  credential?: string;
}
