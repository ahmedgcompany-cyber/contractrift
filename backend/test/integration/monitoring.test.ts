import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { monitors, notificationDeliveries } from '../../src/db/schema.js';
import { hmacSha256 } from '../../src/lib/crypto.js';
import { processOutbox } from '../../src/services/notifications.js';
import { Client, createHarness, type Harness, setupAdmin } from '../support/harness.js';
import { startUpstreams, type Upstreams } from '../support/upstreams.js';

let h: Harness;
let up: Upstreams;
let admin: Client;

beforeAll(async () => {
  up = await startUpstreams();
});
afterAll(async () => {
  await up.close();
});
beforeEach(async () => {
  up.reset();
  if (h) await h.close();
  h = await createHarness();
  admin = await setupAdmin(h.app);
});
afterAll(async () => {
  await h.close();
});

async function createHttpMonitor(extra: Record<string, unknown> = {}) {
  const res = await admin.post('/monitors', {
    name: 'Widgets API',
    kind: 'http',
    baselineSamples: 2,
    failureThreshold: 2,
    tags: ['payments', 'Core'],
    config: { url: `${up.url}/json` },
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.monitor as { id: string } & Record<string, unknown>;
}

const run = (id: string) => admin.post(`/monitors/${id}/run`);

describe('monitor CRUD and validation', () => {
  it('creates, lists with filters, updates and deletes', async () => {
    const m = await createHttpMonitor();
    expect(m).toMatchObject({ kind: 'http', status: 'unknown', tags: ['payments', 'core'], enabled: true });
    expect((m.config as Record<string, unknown>).method).toBe('GET'); // defaults applied
    expect((await admin.get('/monitors?tag=payments')).body.monitors).toHaveLength(1);
    expect((await admin.get('/monitors?tag=nope')).body.monitors).toHaveLength(0);
    expect((await admin.get('/monitors?q=widg')).body.monitors).toHaveLength(1);
    expect((await admin.get('/monitors?kind=llm')).body.monitors).toHaveLength(0);
    const upd = await admin.patch(`/monitors/${m.id}`, { name: 'Renamed', intervalSeconds: 60 });
    expect(upd.body.monitor).toMatchObject({ name: 'Renamed', intervalSeconds: 60 });
    expect((await admin.del(`/monitors/${m.id}`)).status).toBe(204);
    expect((await admin.get(`/monitors/${m.id}`)).status).toBe(404);
  });

  it('returns field-level validation details', async () => {
    const res = await admin.post('/monitors', { name: 'bad', kind: 'http', config: { url: 'not-a-url', method: 'FETCH' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
    const extra = await admin.post('/monitors', { name: 'x', kind: 'http', config: { url: 'https://a.test' }, bogus: 1 });
    expect(extra.status).toBe(400);
    const timeout = await admin.post('/monitors', {
      name: 'x',
      kind: 'http',
      intervalSeconds: 30,
      timeoutMs: 40_000,
      config: { url: 'https://a.test' },
    });
    expect(timeout.status).toBe(400);
  });

  it('treats secrets as write-only and encrypts them at rest', async () => {
    const m = await createHttpMonitor({ secrets: { headers: { Authorization: 'Bearer top-secret-value' } } });
    expect(m.secretKeys).toEqual({ headers: ['Authorization'], query: [], apiKey: false });
    const all = JSON.stringify([(await admin.get(`/monitors/${m.id}`)).body, (await admin.get('/monitors')).body]);
    expect(all).not.toContain('top-secret-value');
    const [row] = await h.ctx.db.select().from(monitors).where(eq(monitors.id, m.id));
    expect(row?.secretsEnc).toMatch(/^v1\./);
    expect(row?.secretsEnc).not.toContain('top-secret');

    // Secret is actually sent upstream.
    await admin.patch(`/monitors/${m.id}`, { config: { url: `${up.url}/echo-headers` } });
    await run(m.id);
    const echoed = up.state.requests.find((r) => r.url === '/echo-headers');
    expect(echoed?.headers.authorization).toBe('Bearer top-secret-value');

    // null removes it; omission keeps it.
    const kept = await admin.patch(`/monitors/${m.id}`, { name: 'n2' });
    expect(kept.body.monitor.secretKeys.headers).toEqual(['Authorization']);
    const removed = await admin.patch(`/monitors/${m.id}`, { secrets: { headers: { authorization: null } } });
    expect(removed.body.monitor.secretKeys.headers).toEqual([]);
  });

  it('dry-runs without persisting', async () => {
    const res = await admin.post('/monitors/test', {
      kind: 'http',
      config: { url: `${up.url}/json`, assertions: [{ path: '$.name', op: 'equals', value: 'Widget' }] },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, statusCode: 200 });
    expect(res.body.observedPaths).toBeGreaterThan(3);
    expect((await admin.get('/monitors')).body.monitors).toHaveLength(0);
  });

  it('dry-run can reuse a saved monitor’s secrets', async () => {
    const m = await createHttpMonitor({ secrets: { headers: { 'x-key': 'stored-secret-1' } } });
    await admin.post('/monitors/test', { kind: 'http', monitorId: m.id, config: { url: `${up.url}/echo-headers` } });
    expect(up.state.requests.at(-1)?.headers['x-key']).toBe('stored-secret-1');
  });
});

describe('availability: incidents', () => {
  it('opens after the threshold, keeps status below it, resolves on success, and notifies', async () => {
    const hook = await admin.post('/channels', { name: 'hook', kind: 'webhook', url: `${up.url}/hook`, secret: 'whsec-0123456789' });
    expect(hook.status).toBe(201);
    const m = await createHttpMonitor();

    expect((await run(m.id)).body).toMatchObject({ status: 'up', incident: null });
    up.state.json.status = 500;
    expect((await run(m.id)).body).toMatchObject({ status: 'up', incident: null }); // 1 failure < threshold 2
    expect((await run(m.id)).body).toMatchObject({ status: 'down', incident: 'opened' });
    expect((await run(m.id)).body).toMatchObject({ status: 'down', incident: 'ongoing' });
    expect((await admin.get('/incidents?status=open')).body.incidents).toHaveLength(1);
    up.state.json.status = 200;
    expect((await run(m.id)).body).toMatchObject({ status: 'up', incident: 'resolved' });
    const incidents = (await admin.get(`/incidents?monitorId=${m.id}`)).body.incidents;
    expect(incidents[0]).toMatchObject({ failureCount: 3 });
    expect(incidents[0].resolvedAt).toBeTruthy();

    const delivered = await processOutbox(h.ctx);
    expect(delivered.sent).toBe(2);
    const events = up.state.hooks.map((x) => x.headers['x-tripline-event']);
    expect(events).toEqual(expect.arrayContaining(['incident.opened', 'incident.resolved']));
    for (const req of up.state.hooks) {
      const expected = `sha256=${hmacSha256('whsec-0123456789', `${req.headers['x-tripline-timestamp']}.${req.body}`)}`;
      expect(req.headers['x-tripline-signature']).toBe(expected);
    }
    const payload = JSON.parse(up.state.hooks.find((x) => x.headers['x-tripline-event'] === 'incident.opened')?.body ?? '{}');
    expect(payload).toMatchObject({ event: 'incident.opened', monitor: { id: m.id }, link: expect.stringContaining(`/monitors/${m.id}`) });

    const results = (await admin.get(`/monitors/${m.id}/results?limit=2`)).body.results;
    expect(results).toHaveLength(2);
    const failed = (await admin.get(`/monitors/${m.id}/results`)).body.results.find((r: { ok: boolean }) => !r.ok);
    expect(failed).toMatchObject({ errorCode: 'HTTP_STATUS', statusCode: 500 });
    expect(failed.responseExcerpt).toBeTruthy();
  });

  it('retries failed deliveries with backoff and gives up after 5 attempts', async () => {
    up.state.hookStatus = 500;
    await admin.post('/channels', { name: 'hook', kind: 'webhook', url: `${up.url}/hook` });
    const m = await createHttpMonitor({ failureThreshold: 1 });
    up.state.json.status = 500;
    await run(m.id);
    for (let i = 0; i < 5; i++) {
      await h.ctx.db.update(notificationDeliveries).set({ nextAttemptAt: new Date(Date.now() - 1000) });
      await processOutbox(h.ctx);
    }
    const [d] = await h.ctx.db.select().from(notificationDeliveries);
    expect(d).toMatchObject({ status: 'failed', attempts: 5, responseStatus: 500 });
    expect(up.state.hooks).toHaveLength(5);
  });
});

describe('drift lifecycle', () => {
  it('learns a baseline, detects breaking drift once, notifies, and can be accepted', async () => {
    await admin.post('/channels', { name: 'hook', kind: 'webhook', url: `${up.url}/hook` });
    const m = await createHttpMonitor();
    expect((await run(m.id)).body.baseline).toBe('learning');
    expect((await run(m.id)).body.baseline).toBe('locked');
    const base = (await admin.get(`/monitors/${m.id}/baseline`)).body;
    expect(base).toMatchObject({ state: 'locked', samples: 2, samplesRequired: 2 });
    expect(base.paths.map((p: { path: string }) => p.path)).toContain('$.owner.email');

    // Upstream silently removes a field and changes a type.
    up.state.json.body = { id: '1', name: 'Widget', price: 9.5, tags: ['a'], owner: { id: 7 } };
    const first = (await run(m.id)).body;
    expect(first).toMatchObject({ status: 'up', drift: { severity: 'breaking', isNew: true, changes: 2 } });
    const second = (await run(m.id)).body;
    expect(second.drift).toMatchObject({ eventId: first.drift.eventId, isNew: false });

    const open = (await admin.get('/drift?status=open')).body.events;
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ occurrences: 2, severity: 'breaking', monitorName: 'Widgets API' });
    expect(open[0].changes.map((c: { kind: string; path: string }) => `${c.kind} ${c.path}`).sort()).toEqual([
      'removed $.owner.email',
      'type_changed $.id',
    ]);

    const list = (await admin.get('/monitors')).body.monitors[0];
    expect(list.openDrift).toEqual({ open: 1, worst: 'breaking' });
    expect(list.recent).toHaveLength(4);

    await processOutbox(h.ctx);
    expect(up.state.hooks.map((x) => x.headers['x-tripline-event'])).toEqual(['drift.breaking']);

    const accepted = await admin.post(`/drift/${open[0].id}/accept`);
    expect(accepted.body.event).toMatchObject({ status: 'accepted' });
    expect((await run(m.id)).body.drift).toBeNull();
    expect((await admin.post(`/drift/${open[0].id}/accept`)).status).toBe(409);
  });

  it('dismiss mutes that exact change set but a different change reopens', async () => {
    const m = await createHttpMonitor();
    await run(m.id);
    await run(m.id);
    up.state.json.body = { id: 1, name: 'Widget', price: 9.5, tags: ['a'], owner: { id: 7, email: 'x' }, beta: true };
    const d = (await run(m.id)).body.drift;
    expect(d).toMatchObject({ severity: 'info', isNew: true });
    await admin.post(`/drift/${d.eventId}/dismiss`);
    expect((await run(m.id)).body.drift).toMatchObject({ eventId: d.eventId, isNew: false });
    expect((await admin.get('/drift?status=open')).body.events).toHaveLength(0);
    up.state.json.body = { id: 1, name: null, price: 9.5, tags: ['a'], owner: { id: 7, email: 'x' } };
    expect((await run(m.id)).body.drift).toMatchObject({ severity: 'warning', isNew: true });
  });

  it('honours ignorePaths and resets the baseline when the request changes', async () => {
    const m = await createHttpMonitor({ ignorePaths: ['$.owner'] });
    await run(m.id);
    await run(m.id);
    up.state.json.body = { id: 1, name: 'Widget', price: 9.5, tags: ['a'] };
    expect((await run(m.id)).body.drift).toBeNull();
    await admin.patch(`/monitors/${m.id}`, { config: { url: `${up.url}/json?v=2` } });
    expect((await admin.get(`/monitors/${m.id}/baseline`)).body.state).toBe('none');
    expect((await run(m.id)).body.baseline).toBe('learning');
    await admin.del(`/monitors/${m.id}/baseline`);
    expect((await admin.get(`/monitors/${m.id}/baseline`)).body.state).toBe('none');
  });

  it('skips drift for unexpected statuses and when drift is disabled', async () => {
    const m = await createHttpMonitor({ driftEnabled: false });
    expect((await run(m.id)).body.baseline).toBe('disabled');
    const m2 = await createHttpMonitor();
    up.state.json.status = 503;
    expect((await run(m2.id)).body.baseline).toBe('skipped');
  });

  it('LLM: a different reported model is warning-level drift', async () => {
    const res = await admin.post('/monitors', {
      name: 'OpenAI',
      kind: 'llm',
      baselineSamples: 1,
      config: {
        provider: 'openai',
        baseUrl: `${up.url}/openai/v1`,
        model: 'gpt-test',
        prompt: 'ping',
        textAssertions: [{ op: 'contains', value: 'pong' }],
      },
      secrets: { apiKey: 'sk-test-openai-key' },
    });
    expect(res.body.monitor.secretKeys.apiKey).toBe(true);
    const id = res.body.monitor.id;
    expect((await run(id)).body).toMatchObject({ status: 'up', baseline: 'locked' });
    up.state.openai.reportedModel = 'gpt-test-2026-09-01';
    const r = (await run(id)).body;
    expect(r.drift).toMatchObject({ severity: 'warning' });
    const ev = (await admin.get(`/drift/${r.drift.eventId}`)).body.event;
    expect(ev.changes[0]).toMatchObject({ kind: 'signature_changed', before: 'gpt-test-2026-01-01', after: 'gpt-test-2026-09-01' });
  });

  it('MCP: removing a tool and adding a required parameter are breaking', async () => {
    const res = await admin.post('/monitors', { name: 'Tools', kind: 'mcp', baselineSamples: 1, config: { url: `${up.url}/mcp-modern` } });
    const id = res.body.monitor.id;
    expect((await run(id)).body.status).toBe('up');
    up.state.mcp.tools = [
      {
        name: 'get_weather',
        inputSchema: { type: 'object', properties: { city: { type: 'string' }, units: { type: 'string' } }, required: ['city', 'units'] },
      },
    ];
    const r = (await run(id)).body;
    expect(r.drift.severity).toBe('breaking');
    const ev = (await admin.get(`/drift/${r.drift.eventId}`)).body.event;
    const summary = ev.changes.map((c: { kind: string; path: string }) => `${c.kind} ${c.path}`);
    expect(summary).toEqual(expect.arrayContaining(['removed $.tools.echo', 'signature_changed tool:get_weather:required']));
  });
});

describe('dashboard summary and CI gate', () => {
  it('summarizes and gates by tag and severity', async () => {
    const a = await createHttpMonitor({ tags: ['payments'] });
    const b = await createHttpMonitor({ name: 'Other', tags: ['search'], config: { url: `${up.url}/json?b` } });
    const token = (await admin.post('/tokens', { name: 'ci' })).body.token;
    const ci = new Client(h.app);
    ci.bearer = token;

    let gate = (await ci.get('/gate?failOn=down,unknown,breaking')).body;
    expect(gate).toMatchObject({ pass: false, evaluated: 2 });
    await run(a.id);
    await run(a.id);
    await run(b.id);
    gate = (await ci.get('/gate')).body;
    expect(gate).toMatchObject({ pass: true, failOn: ['down', 'breaking'] });

    up.state.json.body = { id: 1 };
    await run(a.id);
    gate = (await ci.get('/gate?tags=payments')).body;
    expect(gate.pass).toBe(false);
    expect(gate.failures[0]).toMatchObject({ monitorId: a.id, reason: expect.stringContaining('breaking') });
    expect((await ci.get('/gate?tags=search')).body.pass).toBe(true);
    expect((await ci.get('/gate?failOn=explode')).status).toBe(400);

    const s = (await admin.get('/summary')).body;
    expect(s).toMatchObject({ monitors: { total: 2, up: 2 }, openDrift: { breaking: 1 }, openIncidents: 0 });
    expect(s.checksLast24h.total).toBe(4);

    await admin.patch(`/monitors/${b.id}`, { enabled: false });
    expect((await admin.get('/summary')).body.monitors).toMatchObject({ paused: 1, up: 1 });
  });

  it('records an audit trail for sensitive actions', async () => {
    const m = await createHttpMonitor();
    await admin.patch(`/monitors/${m.id}`, { secrets: { apiKey: 'abc-secret-1' } });
    const entries = (await admin.get('/audit')).body.entries as { action: string; details: unknown }[];
    const actions = entries.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['setup.completed', 'monitor.created', 'monitor.updated']));
    expect(JSON.stringify(entries)).not.toContain('abc-secret-1');
  });
});

describe('channels', () => {
  it('hides URLs and secrets, tests delivery, records deliveries', async () => {
    const c = await admin.post('/channels', { name: 'slack', kind: 'slack', url: 'https://hooks.slack.test/services/T/B/SECRETPART' });
    expect(c.body.channel).toMatchObject({ target: 'hooks.slack.test', hasSecret: false });
    expect(JSON.stringify((await admin.get('/channels')).body)).not.toContain('SECRETPART');
    expect((await admin.post('/channels', { name: 'bad', kind: 'slack', url: 'http://insecure.test/x' })).status).toBe(400);

    const w = (await admin.post('/channels', { name: 'w', kind: 'webhook', url: `${up.url}/hook/test` })).body.channel;
    const t = await admin.post(`/channels/${w.id}/test`);
    expect(t.body).toMatchObject({ ok: true, status: 200 });
    expect(JSON.parse(up.state.hooks[0]?.body ?? '{}')).toMatchObject({ event: 'test' });
    const deliveries = (await admin.get(`/channels/${w.id}/deliveries`)).body.deliveries;
    expect(deliveries[0]).toMatchObject({ eventType: 'test', status: 'sent' });

    const off = await admin.patch(`/channels/${w.id}`, { enabled: false, events: ['drift.breaking'] });
    expect(off.body.channel).toMatchObject({ enabled: false, events: ['drift.breaking'] });
    expect((await admin.del(`/channels/${w.id}`)).status).toBe(204);
  });

  it('respects event subscriptions', async () => {
    await admin.post('/channels', { name: 'drift-only', kind: 'webhook', url: `${up.url}/hook`, events: ['drift.breaking'] });
    const m = await createHttpMonitor({ failureThreshold: 1 });
    up.state.json.status = 500;
    await run(m.id);
    await processOutbox(h.ctx);
    expect(up.state.hooks).toHaveLength(0);
  });
});
