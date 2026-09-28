import path from 'node:path';

export type AppConfig = {
  nodeEnv: 'development' | 'production' | 'test';
  host: string;
  port: number;
  appUrl: string;
  /** PostgreSQL connection string. When absent, embedded PGlite is used. */
  databaseUrl: string | undefined;
  /** Directory for embedded PGlite data; `memory://` for an in-memory database. */
  pgliteDataDir: string;
  /** Key used for all new encryption. */
  encryptionKey: Buffer;
  /** Current key first, then ENCRYPTION_KEY_PREVIOUS keys (rotation). */
  decryptionKeys: Buffer[];
  sessionTtlHours: number;
  /** Per-IP limit for login, setup and password-change requests. */
  authRateLimitPerMinute: number;
  /** When set, first-run setup requires this token (protects fresh public deployments). */
  setupToken: string | undefined;
  /** Public read-only demo account + demo monitors. */
  demoMode: boolean;
  demoEmail: string;
  demoPassword: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  logLevel: string;
  allowPrivateTargets: boolean;
  schedulerEnabled: boolean;
  schedulerConcurrency: number;
  schedulerTickMs: number;
  retentionDays: number;
  frontendDist: string | undefined;
};

export class ConfigError extends Error {}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false;
  throw new ConfigError(`Expected a boolean, got "${value}"`);
}

function int(name: string, value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}, got "${value}"`);
  }
  return n;
}

export function parseEncryptionKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new ConfigError('ENCRYPTION_KEY is required. Generate one with `npm run gen-key`.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new ConfigError('ENCRYPTION_KEY must be 32 bytes encoded as base64 (44 characters).');
  }
  return key;
}

/** ENCRYPTION_KEY_PREVIOUS: comma-separated old keys still accepted for decryption during rotation. */
export function parsePreviousKeys(raw: string | undefined): Buffer[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((k, i) => {
      try {
        return parseEncryptionKey(k);
      } catch {
        throw new ConfigError(`ENCRYPTION_KEY_PREVIOUS entry ${i + 1} must be 32 bytes encoded as base64.`);
      }
    });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    throw new ConfigError(`NODE_ENV must be development, production or test, got "${nodeEnv}"`);
  }
  const port = int('PORT', env.PORT, 3000, 1, 65535);
  // RENDER_EXTERNAL_URL is set automatically on Render, so APP_URL can be left empty there.
  const appUrl = (env.APP_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/+$/, '');
  try {
    new URL(appUrl);
  } catch {
    throw new ConfigError(`APP_URL is not a valid URL: "${appUrl}"`);
  }
  const encryptionKey = parseEncryptionKey(env.ENCRYPTION_KEY);
  const defaultDist = path.resolve(import.meta.dirname, '../../frontend/dist');

  return {
    nodeEnv,
    host: env.HOST ?? '0.0.0.0',
    port,
    appUrl,
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDataDir: env.PGLITE_DATA_DIR ?? path.resolve(import.meta.dirname, '../../data/pglite'),
    encryptionKey,
    decryptionKeys: [encryptionKey, ...parsePreviousKeys(env.ENCRYPTION_KEY_PREVIOUS)],
    setupToken: env.SETUP_TOKEN || undefined,
    demoMode: bool(env.DEMO_MODE, false),
    demoEmail: env.DEMO_EMAIL ?? 'demo@contractrift.dev',
    demoPassword: env.DEMO_PASSWORD ?? 'contractrift-demo',
    authRateLimitPerMinute: int('AUTH_RATE_LIMIT_PER_MINUTE', env.AUTH_RATE_LIMIT_PER_MINUTE, 10, 1, 10_000),
    sessionTtlHours: int('SESSION_TTL_HOURS', env.SESSION_TTL_HOURS, 168, 1, 24 * 90),
    cookieSecure: bool(env.COOKIE_SECURE, nodeEnv === 'production'),
    trustProxy: bool(env.TRUST_PROXY, false),
    logLevel: env.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info'),
    allowPrivateTargets: bool(env.ALLOW_PRIVATE_TARGETS, false),
    schedulerEnabled: bool(env.SCHEDULER_ENABLED, true),
    schedulerConcurrency: int('SCHEDULER_CONCURRENCY', env.SCHEDULER_CONCURRENCY, 8, 1, 256),
    schedulerTickMs: int('SCHEDULER_TICK_MS', env.SCHEDULER_TICK_MS, 5000, 250, 60_000),
    retentionDays: int('RETENTION_DAYS', env.RETENTION_DAYS, 30, 1, 3650),
    frontendDist: env.FRONTEND_DIST === '' ? undefined : (env.FRONTEND_DIST ?? defaultDist),
  };
}
