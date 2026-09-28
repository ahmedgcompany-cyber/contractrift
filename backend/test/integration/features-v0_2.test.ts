import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { monitors, notificationChannels } from '../../src/db/schema.js';
import { decrypt, encryptJson } from '../../src/lib/crypto.js';
import { runProbe } from '../../src/probes/index.js';
import type { Ctx } from '../../src/services/context.js';
import { reencryptAll } from '../../src/services/keys.js';
import { type Client, createHarness, type Harness, setupAdmin, TEST_KEY } from '../support/harness.js';
import { startUpstreams, type Upstreams } from '../support/upstreams.js';

let up: Upstreams;
let h: Harness;
let admin: Client;

beforeAll(async () => {
  up = await startUpstreams();
});
afterAll(async () => {
  await h?.close();
  await up.close();
});
beforeEach(async () => {
  up.reset();
  if (h) await h.close();
  h = await createHarness();
  admin = await setupAdmin(h.app);
});

describe('secret URL query parameters', () => {
  it('are sent upstream, never stored in config or returned, and are redacted', async () => {
    const res = await admin.post('/monitors', {
      name: 'query auth',
      kind: 'http',
      config: { url: `${up.url}/echo-headers?plain=1` },
      secrets: { query: { api_key: 'query-secret-123' } },
    });
    expect(res.status).toBe(201);
    const m = res.body.monitor;
    expect(m.secretKeys.query).toEqual(['api_key']);
    expect(m.config.url).toBe(`${up.url}/echo-headers?plain=1`);
    expect(JSON.stringify((await admin.get(`/monitors/${m.id}`)).body)).not.toContain('query-secret-123');

    await admin.post(`/monitors/${m.id}/run`);
    const sent = up.state.requests.find((r) => r.url === '/echo-headers');
    const params = new URLSearchParams(sent?.search);
    expect(params.get('api_key')).toBe('query-secret-123');
    expect(params.get('plain')).toBe('1');
    const [row] = await h.ctx.db.select().from(monitors).where(eq(monitors.id, m.id));
    expect(row?.secretsEnc).not.toContain('query-secret');

    const removed = await admin.patch(`/monitors/${m.id}`, { secrets: { query: { api_key: null } } });
    expect(removed.body.monitor.secretKeys.query).toEqual([]);
  });

  it('probe appends the parameter and redacts it from failure excerpts', async () => {
    up.state.json.status = 500;
    up.state.json.body = { error: 'bad key query-secret-abc' };
    const out = await runProbe(
      'http',
      { url: `${up.url}/json?x=1`, method: 'GET', headers: {}, expectedStatus: [], followRedirects: false, assertions: [] },
      { query: { key: 'query-secret-abc' } },
      { timeoutMs: 3000, allowPrivateTargets: true },
    );
    expect(out.ok).toBe(false);
    expect(out.excerpt).toContain('[REDACTED]');
    expect(out.excerpt).not.toContain('query-secret-abc');
  });
});

describe('monitor list pagination', () => {
  it('pages in name order and reports the total', async () => {
    for (let i = 0; i < 7; i++) {
      await admin.post('/monitors', {
        name: `m${i}`,
        kind: 'http',
        tags: i % 2 ? ['odd'] : [],
        config: { url: `https://example.com/${i}` },
      });
    }
    const p1 = (await admin.get('/monitors?limit=3')).body;
    expect(p1).toMatchObject({ total: 7, limit: 3, offset: 0 });
    expect(p1.monitors.map((m: { name: string }) => m.name)).toEqual(['m0', 'm1', 'm2']);
    const p3 = (await admin.get('/monitors?limit=3&offset=6')).body;
    expect(p3.monitors.map((m: { name: string }) => m.name)).toEqual(['m6']);
    const filtered = (await admin.get('/monitors?tag=odd&limit=2')).body;
    expect(filtered).toMatchObject({ total: 3 });
    expect(filtered.monitors).toHaveLength(2);
    expect((await admin.get('/monitors?limit=0')).status).toBe(400);
    expect((await admin.get('/monitors?limit=500')).status).toBe(400);
    expect((await admin.get('/monitors')).body.limit).toBe(50);
  });

  it('summary.needsAttention counts distinct monitors down or with breaking drift', async () => {
    const m = (
      await admin.post('/monitors', { name: 'a', kind: 'http', baselineSamples: 1, failureThreshold: 1, config: { url: `${up.url}/json` } })
    ).body.monitor;
    await admin.post(`/monitors/${m.id}/run`);
    expect((await admin.get('/summary')).body.needsAttention).toBe(0);
    up.state.json.body = { id: 1 };
    await admin.post(`/monitors/${m.id}/run`); // breaking drift
    expect((await admin.get('/summary')).body.needsAttention).toBe(1);
    up.state.json.status = 500;
    await admin.post(`/monitors/${m.id}/run`); // also down: still one monitor
    expect((await admin.get('/summary')).body.needsAttention).toBe(1);
  });
});

describe('encryption key rotation', () => {
  const OLD = Buffer.from(TEST_KEY, 'base64');
  const NEW = Buffer.alloc(32, 42);

  it('reads old secrets with ENCRYPTION_KEY_PREVIOUS and re-encrypts them with the new key', async () => {
    const m = (
      await admin.post('/monitors', {
        name: 'r',
        kind: 'http',
        config: { url: `${up.url}/echo-headers` },
        secrets: { headers: { 'x-key': 'rotate-me-1' } },
      })
    ).body.monitor;
    await admin.post('/channels', { name: 'c', kind: 'webhook', url: `${up.url}/hook`, secret: 'whsec-rotate-1' });
    // a value nobody can decrypt
    const [orphan] = await h.ctx.db
      .insert(monitors)
      .values({
        name: 'orphan',
        kind: 'http',
        config: { url: 'https://example.com' },
        secretsEnc: encryptJson({ apiKey: 'x' }, Buffer.alloc(32, 99)),
      })
      .returning();

    const rotated: Ctx = { ...h.ctx, config: { ...h.ctx.config, encryptionKey: NEW, decryptionKeys: [NEW, OLD] } };
    const report = await reencryptAll(rotated);
    expect(report.monitors).toEqual({ total: 2, reencrypted: 1, failed: 1 });
    expect(report.channels).toEqual({ total: 1, reencrypted: 1, failed: 0 });

    const [row] = await h.ctx.db.select().from(monitors).where(eq(monitors.id, m.id));
    expect(JSON.parse(decrypt(row!.secretsEnc!, NEW))).toEqual({ headers: { 'x-key': 'rotate-me-1' } });
    expect(() => decrypt(row!.secretsEnc!, OLD)).toThrow();
    const [ch] = await h.ctx.db.select().from(notificationChannels);
    expect(JSON.parse(decrypt(ch!.configEnc, NEW)).secret).toBe('whsec-rotate-1');

    // idempotent
    expect((await reencryptAll(rotated)).monitors).toEqual({ total: 2, reencrypted: 0, failed: 1 });
    expect(orphan).toBeDefined();
  });

  it('parses ENCRYPTION_KEY_PREVIOUS and rejects malformed entries', () => {
    const cfg = loadConfig({
      ENCRYPTION_KEY: NEW.toString('base64'),
      ENCRYPTION_KEY_PREVIOUS: `${OLD.toString('base64')}, ${Buffer.alloc(32, 1).toString('base64')}`,
    });
    expect(cfg.decryptionKeys).toHaveLength(3);
    expect(cfg.decryptionKeys[0]?.equals(NEW)).toBe(true);
    expect(() => loadConfig({ ENCRYPTION_KEY: NEW.toString('base64'), ENCRYPTION_KEY_PREVIOUS: 'short' })).toThrow(/entry 1/);
  });
});
