#!/usr/bin/env node
/**
 * CI deploy gate for Tripline. Exits 0 when the gate passes, 1 when it fails, 2 on usage/connection errors.
 *
 *   TRIPLINE_URL=https://tripline.example.com TRIPLINE_TOKEN=tl_... \
 *     node scripts/tripline-gate.mjs [--tags payments,search] [--fail-on down,breaking]
 *
 * --fail-on accepts any of: down, unknown, breaking, warning (default: down,breaking).
 * Requires Node.js 18+. No dependencies.
 */
import http from 'node:http';
import https from 'node:https';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** GET JSON without connection pooling (a pooled socket closing during exit crashes Node on Windows). */
function getJson(url, headers) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers, agent: false, timeout: 15_000 }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let body = null;
        try {
          body = JSON.parse(data);
        } catch {
          /* not JSON */
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out after 15 s')));
    req.on('error', reject);
  });
}

async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: TRIPLINE_URL=... TRIPLINE_TOKEN=... node scripts/tripline-gate.mjs [--tags a,b] [--fail-on down,breaking]');
    return 0;
  }
  const base = (process.env.TRIPLINE_URL ?? '').replace(/\/+$/, '');
  const token = process.env.TRIPLINE_TOKEN ?? '';
  if (!base || !token) {
    console.error('TRIPLINE_URL and TRIPLINE_TOKEN must be set.');
    return 2;
  }
  const params = new URLSearchParams();
  if (opt('tags')) params.set('tags', opt('tags'));
  if (opt('fail-on')) params.set('failOn', opt('fail-on'));

  let res;
  try {
    res = await getJson(`${base}/api/v1/gate?${params}`, { authorization: `Bearer ${token}`, accept: 'application/json' });
  } catch (err) {
    console.error(`Cannot reach Tripline at ${base}: ${err.code ?? err.message}`);
    return 2;
  }
  const { status, body } = res;
  if (status !== 200 || !body) {
    console.error(`Gate request failed: HTTP ${status} ${body?.error?.message ?? ''}`);
    return 2;
  }
  const scope = body.tags.length ? `tags [${body.tags.join(', ')}]` : 'all monitors';
  if (body.evaluated === 0 && body.tags.length) {
    // Most likely a typo in --tags; passing silently would make the gate meaningless.
    console.error(`No enabled monitors match ${scope}. Check the --tags value.`);
    return 2;
  }
  if (body.pass) {
    console.log(`Tripline gate PASSED — ${body.evaluated} monitor(s), ${scope}, failOn [${body.failOn.join(', ')}].`);
    return 0;
  }
  console.error(`Tripline gate FAILED — ${scope}, failOn [${body.failOn.join(', ')}]:`);
  for (const f of body.failures) console.error(`  ✗ ${f.name}: ${f.reason}  (${base}/monitors/${f.monitorId})`);
  return 1;
}

process.exitCode = await main();
