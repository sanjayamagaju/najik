import { createServer } from 'node:http';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { allowedOrigins, env } from './config/env.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { messagesRouter } from './routes/messages.js';
import { rtcRouter } from './routes/rtc.js';
import { pushRouter } from './routes/push.js';
import { callsRouter } from './routes/calls.js';
import { initPush } from './push/fcm.js';
import { errorHandler } from './utils/http.js';
import { createRealtime } from './realtime/index.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)),
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }),
);
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'najik', time: Date.now() });
});
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/rtc', rtcRouter);
app.use('/api/push', pushRouter);
app.use('/api/calls', callsRouter);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});
app.use(errorHandler);

initPush();
const httpServer = createServer(app);
createRealtime(httpServer);

httpServer.listen(env.PORT, env.HOST, () => {
  console.log(`✔ Najik server listening on http://${env.HOST}:${env.PORT}`);
  if (!env.TURN_URLS.length) {
    console.warn('⚠ No TURN server configured — calls may fail across strict NATs / mobile networks.');
  }
});

const shutdown = () => {
  console.log('Shutting down…');
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
