/**
 * Captures marketing/README screenshots from the real built app against the local fixture upstreams.
 *   SCREENSHOTS=1 npx playwright test --project=screenshots   (after npm run build)
 * Output: assets/screenshots/*.png
 */
import { expect, type Page, test } from '@playwright/test';

const UP = 'http://127.0.0.1:4011';
const OUT = 'assets/screenshots';
const ADMIN = { name: 'Dana Ops', email: 'dana@example.com', password: 'screenshot-pass-1' };

async function control(patch: unknown) {
  await fetch(`${UP}/__control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
}
const api = (page: Page, method: 'get' | 'post' | 'patch', path: string, data?: unknown) =>
  page.request[method](`/api/v1${path}`, { headers: { 'x-contractrift-csrf': '1' }, ...(data ? { data } : {}) });

test('capture screenshots', async ({ page }) => {
  test.setTimeout(180_000);
  await control({ reset: true });
  await api(page, 'post', '/auth/setup', ADMIN);

  const make = async (body: Record<string, unknown>) => (await (await api(page, 'post', '/monitors', body)).json()).monitor.id as string;
  const payments = await make({
    name: 'Payments API · list invoices',
    kind: 'http',
    tags: ['payments', 'prod'],
    baselineSamples: 3,
    config: { url: `${UP}/json?svc=payments` },
  });
  const search = await make({
    name: 'Search API · product lookup',
    kind: 'http',
    tags: ['search'],
    baselineSamples: 3,
    failureThreshold: 2,
    config: { url: `${UP}/json?svc=search` },
  });
  const llm = await make({
    name: 'LLM gateway · support bot',
    kind: 'llm',
    tags: ['ai'],
    baselineSamples: 1,
    config: {
      provider: 'openai',
      baseUrl: `${UP}/openai/v1`,
      model: 'gpt-test',
      prompt: 'Reply with pong',
      textAssertions: [{ op: 'contains', value: 'pong' }],
    },
    secrets: { apiKey: 'sk-test-openai-key' },
  });
  const mcp = await make({
    name: 'Agent tools · MCP 2026-07-28',
    kind: 'mcp',
    tags: ['ai', 'agents'],
    baselineSamples: 1,
    config: { url: `${UP}/mcp-modern`, expectedTools: ['get_weather'] },
  });
  const legacy = await make({
    name: 'Docs tools · MCP (initialize)',
    kind: 'mcp',
    tags: ['agents'],
    baselineSamples: 1,
    config: { url: `${UP}/mcp-legacy` },
  });
  await make({ name: 'Shipping rates API', kind: 'http', tags: ['logistics'], config: { url: `${UP}/json?svc=shipping` } });

  // Build a latency history with some variation.
  // Manual runs are rate-limited to 30/min, so keep the history short.
  for (let i = 0; i < 4; i++) {
    await control({ json: { delayMs: 40 + Math.round(60 * Math.abs(Math.sin(i))) } });
    for (const id of [payments, search, llm, mcp, legacy]) await api(page, 'post', `/monitors/${id}/run`);
  }
  // Upstream changes: breaking drift on payments, model change on the LLM, tool change on MCP, outage on search.
  await control({ json: { delayMs: 55, body: { id: '1', name: 'Widget', price: 9.5, tags: ['a'], owner: { id: 7 }, currency: 'EUR' } } });
  await api(page, 'post', `/monitors/${payments}/run`);
  await control({ openai: { reportedModel: 'gpt-test-2026-09-01' } });
  await api(page, 'post', `/monitors/${llm}/run`);
  await control({
    mcp: {
      tools: [
        {
          name: 'get_weather',
          inputSchema: { type: 'object', properties: { city: { type: 'string' }, units: { type: 'string' } }, required: ['city', 'units'] },
        },
      ],
    },
  });
  await api(page, 'post', `/monitors/${mcp}/run`);
  await control({ json: { status: 503 } });
  await api(page, 'post', `/monitors/${search}/run`);
  await api(page, 'post', `/monitors/${search}/run`);

  await page.setViewportSize({ width: 1440, height: 900 });
  for (const theme of ['light', 'dark'] as const) {
    await page.addInitScript((t) => localStorage.setItem('contractrift-theme', t), theme);
    await page.goto('/');
    await expect(page.getByText(/attention/)).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/dashboard-${theme}.png` });
  }
  await page.addInitScript(() => localStorage.setItem('contractrift-theme', 'light'));
  await page.goto('/drift');
  await expect(page.getByText('$.owner.email', { exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/drift-inbox.png` });

  await page.goto(`/monitors/${payments}`);
  await expect(page.getByText('Latency')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/monitor-detail.png` });

  await page.goto('/monitors/new');
  await page.getByRole('button', { name: 'MCP server' }).click();
  await page.getByLabel('Name').fill('Agent tools · MCP');
  await page.getByLabel('MCP endpoint URL').fill(`${UP}/mcp-modern`);
  await page.getByRole('button', { name: 'Test configuration' }).click();
  await expect(page.getByText(/Test passed/)).toBeVisible();
  await page.getByText(/Test passed/).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/monitor-form.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/mobile.png` });
});
