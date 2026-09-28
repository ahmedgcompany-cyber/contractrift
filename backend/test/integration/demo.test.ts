import { afterEach, describe, expect, it } from 'vitest';
import { monitors } from '../../src/db/schema.js';
import { DEMO_MONITORS, ensureDemo } from '../../src/services/demo.js';
import { ADMIN, Client, createHarness, type Harness } from '../support/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe('SETUP_TOKEN', () => {
  it('requires the token for first-run setup when configured', async () => {
    h = await createHarness({ SETUP_TOKEN: 'setup-secret-123' });
    const c = new Client(h.app);
    expect((await c.get('/auth/setup-status')).body).toMatchObject({ needsSetup: true, setupTokenRequired: true });
    expect((await c.post('/auth/setup', ADMIN)).status).toBe(403);
    expect((await c.post('/auth/setup', { ...ADMIN, setupToken: 'wrong' })).status).toBe(403);
    expect((await c.post('/auth/setup', { ...ADMIN, setupToken: 'setup-secret-123' })).status).toBe(201);
  });

  it('is not required when unset', async () => {
    h = await createHarness();
    expect((await new Client(h.app).get('/auth/setup-status')).body).toEqual({ needsSetup: true, setupTokenRequired: false });
  });
});

describe('DEMO_MODE', () => {
  const env = { DEMO_MODE: 'true', DEMO_EMAIL: 'demo@example.com', DEMO_PASSWORD: 'demo-pass-123' };

  it('creates a read-only demo account and demo monitors, idempotently', async () => {
    h = await createHarness(env);
    await ensureDemo(h.ctx);
    await ensureDemo(h.ctx);
    expect(await h.ctx.db.select().from(monitors)).toHaveLength(DEMO_MONITORS.length);

    const status = (await new Client(h.app).get('/auth/setup-status')).body;
    expect(status.demo).toEqual({ email: 'demo@example.com', password: 'demo-pass-123' });

    const demo = new Client(h.app);
    expect((await demo.post('/auth/login', { email: 'demo@example.com', password: 'demo-pass-123' })).status).toBe(200);
    expect((await demo.get('/auth/me')).body.user).toMatchObject({ role: 'viewer', mustChangePassword: false });
    expect((await demo.get('/monitors')).body.total).toBe(DEMO_MONITORS.length);
    expect((await demo.post('/monitors', { name: 'x', kind: 'http', config: { url: 'https://example.com' } })).status).toBe(403);
    expect((await demo.post('/tokens', { name: 't' })).status).toBe(403);
    expect((await demo.post('/auth/change-password', { currentPassword: 'demo-pass-123', newPassword: 'hijacked-password' })).status).toBe(
      403,
    );
  });

  it('still allows first-run admin setup after the demo account was created', async () => {
    h = await createHarness({ ...env, SETUP_TOKEN: 'tok-123456' });
    await ensureDemo(h.ctx);
    const c = new Client(h.app);
    expect((await c.get('/auth/setup-status')).body).toMatchObject({ needsSetup: true, setupTokenRequired: true });
    expect((await c.post('/auth/setup', { ...ADMIN, setupToken: 'tok-123456' })).status).toBe(201);
    expect((await c.get('/auth/setup-status')).body.needsSetup).toBe(false);
    expect((await new Client(h.app).post('/auth/setup', { ...ADMIN, email: 'x@example.com', setupToken: 'tok-123456' })).status).toBe(409);
  });

  it('cannot be locked out by strangers', async () => {
    h = await createHarness(env);
    await ensureDemo(h.ctx);
    for (let i = 0; i < 12; i++) {
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-contractrift-csrf': '1' },
        payload: { email: 'demo@example.com', password: 'wrong-password' },
        remoteAddress: `10.9.0.${i}`,
      });
    }
    const ok = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-contractrift-csrf': '1' },
      payload: { email: 'demo@example.com', password: 'demo-pass-123' },
      remoteAddress: '10.9.1.1',
    });
    expect(ok.statusCode).toBe(200);
  });

  it('is off by default', async () => {
    h = await createHarness();
    await ensureDemo(h.ctx);
    expect(await h.ctx.db.select().from(monitors)).toHaveLength(0);
    expect((await new Client(h.app).get('/auth/setup-status')).body.demo).toBeUndefined();
  });
});
