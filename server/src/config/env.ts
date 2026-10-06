import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  // Optional: when unset, a strong secret is generated once and stored next to the database.
  JWT_SECRET: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
  ),
  JWT_EXPIRES_IN: z.string().default('30d'),
  DATABASE_PATH: z.string().default('./data/najik.db'),
  CORS_ORIGINS: csv,
  STUN_URLS: csv.transform((v) =>
    v.length ? v : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
  ),
  TURN_URLS: csv,
  TURN_SECRET: z.string().optional().default(''),
  TURN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  TURN_USERNAME: z.string().optional().default(''),
  TURN_CREDENTIAL: z.string().optional().default(''),
  CALL_RING_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(120).default(40),
  // Firebase Cloud Messaging (push for incoming calls). Either a path to the
  // service-account JSON, or the same JSON base64-encoded (handy for containers).
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional().default(''),
  FIREBASE_SERVICE_ACCOUNT_BASE64: z.string().optional().default(''),
  /** Development aid: log pushes to the console instead of sending them. */
  FCM_LOG_ONLY: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('✖ Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('Fix the values in server/.env (see server/.env.example).');
  process.exit(1);
}

/**
 * Zero-config start: without JWT_SECRET, generate one on first run and keep it
 * in `<database dir>/jwt-secret` so sign-ins survive restarts.
 */
function resolveJwtSecret(configured: string | undefined, databasePath: string): string {
  if (configured) return configured;
  const file = join(dirname(resolve(databasePath)), 'jwt-secret');
  if (existsSync(file)) {
    const saved = readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
  }
  const secret = randomBytes(48).toString('base64url');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, secret, { mode: 0o600 });
  console.log(`✔ Generated a JWT secret (${file}). Set JWT_SECRET to manage it yourself.`);
  return secret;
}

export const env = {
  ...parsed.data,
  JWT_SECRET: resolveJwtSecret(parsed.data.JWT_SECRET, parsed.data.DATABASE_PATH),
};

/** Origins used by the Capacitor Android WebView, always allowed. */
export const NATIVE_APP_ORIGINS = ['https://localhost', 'http://localhost', 'capacitor://localhost'];

export const allowedOrigins = new Set([...NATIVE_APP_ORIGINS, ...env.CORS_ORIGINS]);
