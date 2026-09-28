import { sql } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { type Database, openDatabase } from '../../src/db/client.js';
import { closeHttpAgents } from '../../src/lib/http-client.js';
import type { Ctx } from '../../src/services/context.js';

export const TEST_KEY = Buffer.alloc(32, 7).toString('base64');
export const ADMIN = { email: 'admin@example.com', name: 'Admin', password: 'correct horse battery' };

export type Harness = {
  app: FastifyInstance;
  ctx: Ctx;
  database: Database;
  close(): Promise<void>;
};

export async function createHarness(env: Record<string, string> = {}): Promise<Harness> {
  const config = loadConfig({
    NODE_ENV: 'test',
    ENCRYPTION_KEY: TEST_KEY,
    ALLOW_PRIVATE_TARGETS: 'true',
    FRONTEND_DIST: '',
    APP_URL: 'http://localhost:3000',
    ...env,
  });
  // TEST_DATABASE_URL runs the suite against a real PostgreSQL (CI); otherwise in-memory PGlite.
  // With a real server the schema is wiped for every harness, so files must not run in parallel.
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const database = await openDatabase(databaseUrl ? { databaseUrl } : {});
  if (databaseUrl) {
    await database.db.execute(sql`drop schema if exists public cascade`);
    await database.db.execute(sql`drop schema if exists drizzle cascade`);
    await database.db.execute(sql`create schema public`);
  }
  await database.migrate();
  const { app, ctx } = await buildApp(config, database, { logger: false });
  await app.ready();
  return {
    app,
    ctx,
    database,
    async close() {
      await app.close();
      await database.close();
      await closeHttpAgents();
    },
  };
}

/** A tiny API client that keeps the session cookie and sends the CSRF header like the SPA does. */
export class Client {
  cookie: string | undefined;
  bearer: string | undefined;
  constructor(private readonly app: FastifyInstance) {}

  async req(
    method: InjectOptions['method'],
    url: string,
    body?: unknown,
    extra: { csrf?: boolean; headers?: Record<string, string> } = {},
  ) {
    const headers: Record<string, string> = { ...extra.headers };
    if (this.cookie) headers.cookie = this.cookie;
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    if (extra.csrf !== false && method !== 'GET') headers['x-contractrift-csrf'] = '1';
    const res = await this.app.inject({
      method,
      url: `/api/v1${url}`,
      headers,
      ...(body === undefined ? {} : { payload: body as object }),
    });
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      const first = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '';
      const pair = first.split(';')[0] ?? '';
      this.cookie = pair.endsWith('=') ? undefined : pair;
    }
    return { status: res.statusCode, body: res.body ? (res.json() as Record<string, any>) : {}, headers: res.headers };
  }
  get = (url: string) => this.req('GET', url);
  post = (url: string, body?: unknown) => this.req('POST', url, body ?? {});
  patch = (url: string, body: unknown) => this.req('PATCH', url, body);
  del = (url: string) => this.req('DELETE', url);
}

/** Completes first-run setup and returns a signed-in admin client. */
export async function setupAdmin(app: FastifyInstance): Promise<Client> {
  const c = new Client(app);
  const res = await c.post('/auth/setup', ADMIN);
  if (res.status !== 201) throw new Error(`setup failed: ${JSON.stringify(res.body)}`);
  return c;
}

/** Creates a user via the admin client, signs them in and completes the forced password change. */
export async function userWithRole(
  app: FastifyInstance,
  admin: Client,
  role: 'viewer' | 'editor' | 'admin',
  email = `${role}@example.com`,
): Promise<Client> {
  const initial = 'initial-password-1';
  const created = await admin.post('/users', { email, name: role, role, password: initial });
  if (created.status !== 201) throw new Error(JSON.stringify(created.body));
  const c = new Client(app);
  await c.post('/auth/login', { email, password: initial });
  const changed = await c.post('/auth/change-password', { currentPassword: initial, newPassword: 'a-brand-new-password' });
  if (changed.status !== 204) throw new Error(JSON.stringify(changed.body));
  return c;
}
