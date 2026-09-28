import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, sessions, users } from '../../src/db/schema.js';
import { ADMIN, Client, createHarness, type Harness, setupAdmin, userWithRole } from '../support/harness.js';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

describe('first-run setup', () => {
  it('reports setup status and allows exactly one setup', async () => {
    const c = new Client(h.app);
    expect((await c.get('/auth/setup-status')).body).toEqual({ needsSetup: true });
    const res = await c.post('/auth/setup', ADMIN);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: ADMIN.email, role: 'admin' });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(String(res.headers['set-cookie'])).toMatch(/tripline_session=.+HttpOnly.+SameSite=Lax/i);
    expect((await c.get('/auth/setup-status')).body).toEqual({ needsSetup: false });
    const again = await new Client(h.app).post('/auth/setup', { ...ADMIN, email: 'x@example.com' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SETUP_ALREADY_DONE');
  });

  it('enforces the password policy with a structured error', async () => {
    const res = await new Client(h.app).post('/auth/setup', { ...ADMIN, password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(res.body.error.request_id).toBeTruthy();
  });

  it('stores an argon2id hash, never the password', async () => {
    await setupAdmin(h.app);
    const [u] = await h.ctx.db.select().from(users);
    expect(u?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(u?.passwordHash).not.toContain(ADMIN.password);
  });
});

describe('login / logout / sessions', () => {
  beforeEach(async () => {
    await setupAdmin(h.app);
  });

  it('logs in case-insensitively and returns the current user', async () => {
    const c = new Client(h.app);
    const res = await c.post('/auth/login', { email: ADMIN.email.toUpperCase(), password: ADMIN.password });
    expect(res.status).toBe(200);
    const me = await c.get('/auth/me');
    expect(me.body).toMatchObject({ user: { email: ADMIN.email }, via: 'session' });
  });

  it('uses one generic error for unknown email and wrong password', async () => {
    const a = await new Client(h.app).post('/auth/login', { email: 'nobody@example.com', password: 'whatever-123' });
    const b = await new Client(h.app).post('/auth/login', { email: ADMIN.email, password: 'wrong-password' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('locks the account after 10 consecutive failures', async () => {
    const c = new Client(h.app);
    for (let i = 0; i < 10; i++) {
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-tripline-csrf': '1', 'x-forwarded-for': `10.0.0.${i}` },
        payload: { email: ADMIN.email, password: 'wrong-password' },
        remoteAddress: `10.0.1.${i}`,
      });
    }
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-tripline-csrf': '1' },
      payload: { email: ADMIN.email, password: ADMIN.password },
      remoteAddress: '10.0.2.1',
    });
    expect(res.statusCode).toBe(423);
    expect(res.json().error.code).toBe('ACCOUNT_LOCKED');
    expect(c.cookie).toBeUndefined();
    const actions = (await h.ctx.db.select().from(auditLog)).map((a) => a.action);
    expect(actions).toContain('auth.account_locked');
  });

  it('rate limits login attempts per IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await new Client(h.app).post('/auth/login', { email: 'nobody@example.com', password: 'whatever-123' });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('logout deletes the session server-side', async () => {
    const c = new Client(h.app);
    await c.post('/auth/login', { email: ADMIN.email, password: ADMIN.password });
    const cookie = c.cookie;
    expect((await c.post('/auth/logout')).status).toBe(204);
    const reuse = await h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: cookie ?? '' } });
    expect(reuse.statusCode).toBe(401);
  });

  it('stores only a hash of the session token', async () => {
    const c = new Client(h.app);
    await c.post('/auth/login', { email: ADMIN.email, password: ADMIN.password });
    const token = c.cookie?.split('=')[1] ?? '';
    const rows = await h.ctx.db.select().from(sessions);
    expect(rows.some((r) => r.id === token)).toBe(false);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.id))).toBe(true);
  });

  it('expired sessions are rejected', async () => {
    const c = new Client(h.app);
    await c.post('/auth/login', { email: ADMIN.email, password: ADMIN.password });
    await h.ctx.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await c.get('/auth/me')).status).toBe(401);
  });
});

describe('CSRF and security headers', () => {
  it('rejects state-changing requests without the CSRF header', async () => {
    const c = await setupAdmin(h.app);
    const res = await c.req('POST', '/monitors', { name: 'x', kind: 'http', config: { url: 'https://example.com' } }, { csrf: false });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('rejects cross-origin requests even with the header', async () => {
    const c = await setupAdmin(h.app);
    const res = await c.req(
      'POST',
      '/monitors',
      { name: 'x', kind: 'http', config: { url: 'https://example.com' } },
      { headers: { origin: 'https://evil.example' } },
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('sets security headers and echoes request ids', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/auth/setup-status', headers: { 'x-request-id': 'abc-123' } });
    expect(res.headers['x-request-id']).toBe('abc-123');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns structured 404s for unknown API routes', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('healthz and readyz respond', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ status: 'ok' });
    expect((await h.app.inject({ method: 'GET', url: '/readyz' })).json()).toMatchObject({ status: 'ready', database: 'pglite' });
  });
});

describe('roles and users', () => {
  it('requires authentication', async () => {
    await setupAdmin(h.app);
    expect((await new Client(h.app).get('/monitors')).status).toBe(401);
  });

  it('forces a password change for admin-created users', async () => {
    const admin = await setupAdmin(h.app);
    await admin.post('/users', { email: 'v@example.com', name: 'V', role: 'viewer', password: 'initial-password-1' });
    const c = new Client(h.app);
    await c.post('/auth/login', { email: 'v@example.com', password: 'initial-password-1' });
    const blocked = await c.get('/monitors');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await c.get('/auth/me')).status).toBe(200);
    expect((await c.post('/auth/change-password', { currentPassword: 'wrong', newPassword: 'a-brand-new-password' })).status).toBe(400);
    expect(
      (await c.post('/auth/change-password', { currentPassword: 'initial-password-1', newPassword: 'a-brand-new-password' })).status,
    ).toBe(204);
    expect((await c.get('/monitors')).status).toBe(200);
  });

  it('enforces viewer < editor < admin', async () => {
    const admin = await setupAdmin(h.app);
    const viewer = await userWithRole(h.app, admin, 'viewer');
    const editor = await userWithRole(h.app, admin, 'editor');
    const body = { name: 'm', kind: 'http', config: { url: 'https://example.com/x' } };
    expect((await viewer.post('/monitors', body)).status).toBe(403);
    expect((await editor.post('/monitors', body)).status).toBe(201);
    expect((await editor.get('/users')).status).toBe(403);
    expect((await editor.get('/channels')).status).toBe(403);
    expect((await admin.get('/users')).body.users).toHaveLength(3);
  });

  it('protects the last active admin and self-deletion', async () => {
    const admin = await setupAdmin(h.app);
    const me = (await admin.get('/auth/me')).body.user;
    expect((await admin.patch(`/users/${me.id}`, { role: 'viewer' })).status).toBe(409);
    expect((await admin.del(`/users/${me.id}`)).status).toBe(409);
    const other = await admin.post('/users', { email: 'a2@example.com', name: 'A2', role: 'admin', password: 'initial-password-1' });
    expect((await admin.patch(`/users/${me.id}`, { role: 'editor' })).status).toBe(200);
    expect(other.status).toBe(201);
  });

  it('rejects duplicate emails case-insensitively', async () => {
    const admin = await setupAdmin(h.app);
    const res = await admin.post('/users', { email: 'ADMIN@example.com', name: 'x', role: 'viewer', password: 'initial-password-1' });
    expect(res.status).toBe(409);
  });

  it('admin reset gives a one-time temporary password and signs the user out', async () => {
    const admin = await setupAdmin(h.app);
    const viewer = await userWithRole(h.app, admin, 'viewer');
    const id = (await viewer.get('/auth/me')).body.user.id;
    const reset = await admin.post(`/users/${id}/reset-password`);
    expect(reset.body.temporaryPassword).toMatch(/.{12,}/);
    expect((await viewer.get('/auth/me')).status).toBe(401);
    const again = new Client(h.app);
    expect((await again.post('/auth/login', { email: 'viewer@example.com', password: reset.body.temporaryPassword })).status).toBe(200);
  });

  it('disabling a user ends their sessions', async () => {
    const admin = await setupAdmin(h.app);
    const viewer = await userWithRole(h.app, admin, 'viewer');
    const id = (await viewer.get('/auth/me')).body.user.id;
    await admin.patch(`/users/${id}`, { disabled: true });
    expect((await viewer.get('/auth/me')).status).toBe(401);
    const [row] = await h.ctx.db.select().from(users).where(eq(users.id, id));
    expect(row?.disabled).toBe(true);
  });
});

describe('API tokens', () => {
  it('are read-only, shown once, revocable', async () => {
    const admin = await setupAdmin(h.app);
    const created = await admin.post('/tokens', { name: 'ci' });
    expect(created.status).toBe(201);
    const token: string = created.body.token;
    expect(token).toMatch(/^tl_/);
    expect(JSON.stringify((await admin.get('/tokens')).body)).not.toContain(token);

    const ci = new Client(h.app);
    ci.bearer = token;
    expect((await ci.get('/monitors')).status).toBe(200);
    expect((await ci.get('/auth/me')).body.via).toBe('token');
    const write = await ci.post('/monitors', { name: 'x', kind: 'http', config: { url: 'https://example.com' } });
    expect(write.status).toBe(403);

    await admin.del(`/tokens/${created.body.apiToken.id}`);
    expect((await ci.get('/monitors')).status).toBe(401);
  });

  it('expired tokens are rejected and garbage tokens get 401', async () => {
    const admin = await setupAdmin(h.app);
    const ci = new Client(h.app);
    ci.bearer = 'tl_notarealtoken';
    expect((await ci.get('/monitors')).status).toBe(401);
    const created = await admin.post('/tokens', { name: 'short', expiresInDays: 1 });
    const { apiTokens } = await import('../../src/db/schema.js');
    await h.ctx.db.update(apiTokens).set({ expiresAt: new Date(Date.now() - 1000) });
    ci.bearer = created.body.token;
    expect((await ci.get('/monitors')).status).toBe(401);
  });
});
