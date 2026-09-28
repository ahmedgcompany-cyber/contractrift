/**
 * Creates demo monitors for local exploration. Two modes:
 *
 *   npm run seed:demo -w backend -- --upstreams http://127.0.0.1:4010
 *       HTTP, LLM and MCP monitors against the local test-substitute upstreams
 *       (start them with `npm run upstreams -w backend`; needs ALLOW_PRIVATE_TARGETS=true).
 *
 *   npm run seed:demo -w backend -- --public
 *       One HTTP monitor against a real public API (GitHub repository metadata, hourly).
 *
 * Idempotent by name: existing monitors with the same name are left untouched.
 */
import { eq } from 'drizzle-orm';
import { loadConfig } from '../../backend/src/config.js';
import { openDatabase } from '../../backend/src/db/client.js';
import { monitors } from '../../backend/src/db/schema.js';
import type { Ctx } from '../../backend/src/services/context.js';
import { createMonitor, type MonitorInput } from '../../backend/src/services/monitors.js';

const args = process.argv.slice(2);
const upstreamsIdx = args.indexOf('--upstreams');
const upstreams = upstreamsIdx >= 0 ? args[upstreamsIdx + 1] : undefined;
const usePublic = args.includes('--public');
if (!upstreams && !usePublic) {
  console.error('Pass --upstreams <url> or --public. See the header of database/seeds/demo.ts.');
  process.exit(2);
}

const config = loadConfig();
const database = await openDatabase({ databaseUrl: config.databaseUrl, pgliteDataDir: config.pgliteDataDir });
await database.migrate();
const log = { debug() {}, info() {}, warn: console.warn, error: console.error };
const ctx: Ctx = { db: database.db, config, log };

const demo: MonitorInput[] = [];
if (upstreams) {
  demo.push(
    {
      name: 'Demo · Widgets JSON API',
      kind: 'http',
      intervalSeconds: 60,
      tags: ['demo'],
      baselineSamples: 2,
      config: { url: `${upstreams}/json` },
    },
    {
      name: 'Demo · OpenAI-compatible LLM',
      kind: 'llm',
      intervalSeconds: 300,
      tags: ['demo', 'ai'],
      baselineSamples: 1,
      config: {
        provider: 'openai',
        baseUrl: `${upstreams}/openai/v1`,
        model: 'gpt-test',
        prompt: 'Reply with the single word: pong',
        textAssertions: [{ op: 'contains', value: 'pong' }],
      },
      secrets: { apiKey: 'sk-test-openai-key' },
    },
    {
      name: 'Demo · MCP tool server (2026-07-28)',
      kind: 'mcp',
      intervalSeconds: 120,
      tags: ['demo', 'ai'],
      baselineSamples: 1,
      config: {
        url: `${upstreams}/mcp-modern`,
        expectedTools: ['get_weather'],
        toolCall: { name: 'get_weather', arguments: { city: 'Oslo' }, expectText: 'Oslo' },
      },
    },
  );
}
if (usePublic) {
  demo.push({
    name: 'GitHub · nodejs/node repository',
    kind: 'http',
    intervalSeconds: 3600,
    tags: ['public'],
    // Counts and timestamps change constantly but keep their types, so they don't cause drift.
    config: {
      url: 'https://api.github.com/repos/nodejs/node',
      headers: { accept: 'application/vnd.github+json' },
      assertions: [{ path: '$.full_name', op: 'equals', value: 'nodejs/node' }],
    },
  });
}

for (const m of demo) {
  const [existing] = await database.db.select({ id: monitors.id }).from(monitors).where(eq(monitors.name, m.name));
  if (existing) {
    console.log(`skip   ${m.name} (exists)`);
    continue;
  }
  const created = await createMonitor(ctx, m, { userId: null, ip: 'seed' });
  console.log(`create ${m.name} → ${created.id}`);
}
await database.close();
