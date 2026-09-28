import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkResults, monitors, sessions } from '../../src/db/schema.js';
import { claimDueMonitors, Jobs, pruneOldData } from '../../src/jobs/jobs.js';
import { generateOpenApi } from '../../src/openapi-export.js';
import { createHarness, type Harness, setupAdmin } from '../support/harness.js';
import { startUpstreams, type Upstreams } from '../support/upstreams.js';

let h: Harness;
let up: Upstreams;

beforeAll(async () => {
  up = await startUpstreams();
  h = await createHarness({ SCHEDULER_CONCURRENCY: '4', RETENTION_DAYS: '7' });
  const admin = await setupAdmin(h.app);
  for (let i = 0; i < 6; i++) {
    await admin.post('/monitors', { name: `m${i}`, kind: 'http', intervalSeconds: 60, config: { url: `${up.url}/json?i=${i}` } });
  }
});
afterAll(async () => {
  await h.close();
  await up.close();
});

describe('scheduler', () => {
  it('claims at most `limit` due monitors, advances next_run_at, and never double-claims', async () => {
    const [a, b] = await Promise.all([claimDueMonitors(h.ctx, 4), claimDueMonitors(h.ctx, 4)]);
    const ids = [...a, ...b].map((m) => m.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(await claimDueMonitors(h.ctx, 10)).toHaveLength(0);
    const rows = await h.ctx.db.select().from(monitors);
    for (const r of rows) expect(r.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it('Jobs.tick runs due, enabled monitors and records results', async () => {
    await h.ctx.db.update(monitors).set({ nextRunAt: new Date(Date.now() - 1000) });
    await h.ctx.db.update(monitors).set({ enabled: false }).where(eq(monitors.name, 'm5'));
    const jobs = new Jobs(h.ctx);
    await jobs.tick(); // concurrency 4
    await jobs.stop();
    const results = await h.ctx.db.select().from(checkResults);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

describe('retention', () => {
  it('prunes old results and expired sessions only', async () => {
    const [m] = await h.ctx.db.select().from(monitors);
    await h.ctx.db
      .insert(checkResults)
      .values({ monitorId: m!.id, startedAt: new Date(Date.now() - 8 * 86_400_000), durationMs: 1, ok: true });
    const before = (await h.ctx.db.select().from(checkResults)).length;
    const [anySession] = await h.ctx.db.select().from(sessions);
    await h.ctx.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, anySession!.id));
    const removed = await pruneOldData(h.ctx);
    expect(removed).toMatchObject({ checkResults: 1, sessions: 1 });
    expect((await h.ctx.db.select().from(checkResults)).length).toBe(before - 1);
  });
});

describe('OpenAPI document', () => {
  it('committed api/openapi.yaml matches the route schemas (run `npm run openapi` if this fails)', async () => {
    const committed = readFileSync(path.resolve(import.meta.dirname, '../../../api/openapi.yaml'), 'utf8');
    expect(committed).toBe(await generateOpenApi());
  });
});
