import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { AppError } from './lib/errors.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandling } from './plugins/errors.js';
import { authRoutes } from './routes/auth.js';
import { channelRoutes } from './routes/channels.js';
import { eventRoutes } from './routes/events.js';
import { monitorRoutes } from './routes/monitors.js';
import { ErrorResponse } from './routes/schemas.js';
import { systemRoutes } from './routes/system.js';
import { userRoutes } from './routes/users.js';
import type { Ctx } from './services/context.js';

export const API_PREFIX = '/api/v1';
export const VERSION = '0.2.0';

const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.secrets',
  '*.apiKey',
];

export type BuiltApp = { app: FastifyInstance; ctx: Ctx };

export async function buildApp(config: AppConfig, database: Database, opts: { logger?: boolean } = {}): Promise<BuiltApp> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel, redact: { paths: REDACT, censor: '[REDACTED]' } },
    trustProxy: config.trustProxy,
    bodyLimit: 512 * 1024,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    },
    ajv: { customOptions: { removeAdditional: false, coerceTypes: 'array', useDefaults: true, allErrors: false } },
  }).withTypeProvider<TypeBoxTypeProvider>();

  const ctx: Ctx = { db: database.db, config, log: app.log };

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
    hsts: config.cookieSecure,
  });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  await app.register(cookie);
  registerErrorHandling(app);
  registerAuth(app, ctx);

  app.addSchema(ErrorResponse);
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Tripline API',
        version: VERSION,
        description:
          'Self-hosted dependency drift monitor. Authenticate with the session cookie (browser; state-changing requests need header `X-Tripline-CSRF: 1`) or a read-only bearer API token.',
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: 'tripline_session' },
          token: { type: 'http', scheme: 'bearer', description: 'Read-only API token (tl_…)' },
        },
      },
      security: [{ session: [] }, { token: [] }],
    },
  });

  app.get('/healthz', { schema: { hide: true } }, async () => ({ status: 'ok' }));
  app.get('/readyz', { schema: { hide: true } }, async (_req, reply) => {
    try {
      await database.ping();
      return { status: 'ready', database: database.driver };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes(ctx));
      await api.register(userRoutes(ctx));
      await api.register(monitorRoutes(ctx));
      await api.register(eventRoutes(ctx));
      await api.register(channelRoutes(ctx));
      await api.register(systemRoutes(ctx));
      api.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
    },
    { prefix: API_PREFIX },
  );

  const dist = config.frontendDist;
  const hasFrontend = !!dist && existsSync(path.join(dist, 'index.html'));
  if (hasFrontend) {
    await app.register(fastifyStatic, {
      root: dist,
      wildcard: false,
      setHeaders: (reply, filePath) => {
        // @fastify/static v10 passes the Fastify reply here.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) reply.header('cache-control', 'public, max-age=31536000, immutable');
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    const pathname = req.url.split('?')[0] ?? '';
    // Only extension-less GET paths are client-side routes; a missing asset is a real 404.
    if (req.url.startsWith('/api/') || req.method !== 'GET' || !hasFrontend || /\.[a-z0-9]+$/i.test(pathname)) {
      throw new AppError('NOT_FOUND', `Route ${req.method} ${req.url.split('?')[0]} was not found.`);
    }
    // Client-side routes of the single-page app.
    return reply.header('cache-control', 'no-cache').sendFile('index.html', { cacheControl: false });
  });

  return { app, ctx };
}
