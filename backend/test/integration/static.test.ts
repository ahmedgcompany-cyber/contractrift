import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../support/harness.js';

let h: Harness;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'contractrift-dist-'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(path.join(dir, 'assets', 'app-abc.css'), 'body{}');
  h = await createHarness({ FRONTEND_DIST: dir });
});
afterAll(async () => {
  await h.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('frontend serving', () => {
  it('serves hashed assets with immutable caching', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/assets/app-abc.css' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/monitors/123' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('id="root"');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('keeps JSON 404s for unknown API routes and non-GET requests', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/missing' })).json().error.code).toBe('NOT_FOUND');
    expect((await h.app.inject({ method: 'POST', url: '/whatever' })).statusCode).toBe(404);
    const missing = await h.app.inject({ method: 'GET', url: '/assets/gone-123.js' });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toContain('application/json');
  });
});
