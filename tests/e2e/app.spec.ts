import { expect, type Page, test } from '@playwright/test';

const UP = 'http://127.0.0.1:4011';
const ADMIN = { name: 'E2E Admin', email: 'admin@e2e.test', password: 'e2e-password-123' };

async function control(patch: unknown) {
  const res = await fetch(`${UP}/__control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  expect(res.ok).toBe(true);
}

async function login(page: Page, email = ADMIN.email, password = ADMIN.password, expectSuccess = true) {
  // Lets a test run on its own (e.g. `--project=mobile`) against a fresh server.
  const status = await (await page.request.get('/api/v1/auth/setup-status')).json();
  if (status.needsSetup) {
    await page.request.post('/api/v1/auth/setup', { data: ADMIN, headers: { 'x-tripline-csrf': '1' } });
    await page.context().clearCookies();
  }
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (expectSuccess) await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await control({ reset: true });
});

test('first-run setup creates the admin and lands on an empty dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel('Name').fill(ADMIN.name);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('Confirm password').fill('mismatch-000');
  await expect(page.getByText('Passwords do not match.')).toBeVisible();
  await page.getByLabel('Confirm password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Nothing is being watched yet' })).toBeVisible();
});

test('wrong password shows a generic error', async ({ page }) => {
  await login(page, ADMIN.email, 'not-the-password', false);
  await expect(page.getByRole('alert')).toContainText('Invalid email or password');
});

test('create an HTTP monitor with a dry run, learn a baseline, detect and accept drift', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'New monitor' }).first().click();
  await page.getByLabel('Name').fill('Widgets API');
  await page.getByLabel('URL').fill(`${UP}/json`);
  await page.getByLabel('Tags').fill('payments');
  await page.getByLabel('Learn baseline from').fill('2');
  await page.getByRole('button', { name: 'Test configuration' }).click();
  await expect(page.getByText(/Test passed/)).toBeVisible();
  await page.getByRole('button', { name: 'Create monitor' }).click();

  await expect(page.getByRole('heading', { name: /Widgets API/ })).toBeVisible();
  const run = page.getByRole('button', { name: 'Run check now' });
  await run.click();
  await expect(page.getByText(/Check passed/).first()).toBeVisible();
  await run.click();
  await page.getByRole('tab', { name: 'Baseline' }).click();
  await expect(page.getByText(/Locked .* from 2 sample/)).toBeVisible();
  await expect(page.getByRole('cell', { name: '$.owner.email' })).toBeVisible();

  // Upstream silently removes a field and re-types another.
  await control({ json: { body: { id: '1', name: 'Widget', price: 9.5, tags: ['a'], owner: { id: 7 } } } });
  await run.click();
  await expect(page.getByText(/breaking drift detected/)).toBeVisible();

  await page.getByRole('link', { name: /Drift inbox/ }).click();
  const card = page.getByRole('article', { name: 'Drift on Widgets API' });
  await expect(card.getByText('$.owner.email', { exact: true })).toBeVisible();
  await expect(card.getByText('breaking', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Accept as baseline' }).click();
  await expect(page.getByText('Inbox zero')).toBeVisible();
});

test('availability failures open and resolve an incident', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Monitors' }).click();
  await page.getByRole('link', { name: 'Widgets API' }).click();
  await control({ json: { status: 503 } });
  const run = page.getByRole('button', { name: 'Run check now' });
  await run.click();
  await expect(page.getByText(/Check failed/).first()).toBeVisible();
  await run.click();
  await expect(page.getByText(/incident opened/)).toBeVisible();
  await expect(page.getByText('down', { exact: true }).first()).toBeVisible();
  await control({ json: { status: 200 } });
  await run.click();
  await expect(page.getByText(/incident resolved/)).toBeVisible();
  await page.getByRole('link', { name: /^Incidents/ }).click();
  await expect(page.getByText('resolved', { exact: true })).toBeVisible();
});

test('LLM monitor with a write-only API key', async ({ page }) => {
  await login(page);
  await page.goto('/monitors/new');
  await page.getByRole('button', { name: 'LLM API' }).click();
  await page.getByLabel('Name').fill('OpenAI-compatible');
  await page.getByLabel('Model').fill('gpt-test');
  await page.getByLabel('Base URL').fill(`${UP}/openai/v1`);
  await page.getByLabel('API key').fill('sk-test-openai-key');
  await page.getByRole('button', { name: 'Test configuration' }).click();
  await expect(page.getByText(/Test passed/)).toBeVisible();
  await page.getByRole('button', { name: 'Create monitor' }).click();
  await page.getByRole('button', { name: 'Run check now' }).click();
  await expect(page.getByText(/Check passed/).first()).toBeVisible();
  await expect(page.getByText('API key')).toBeVisible();
  await expect(page.getByText('sk-test-openai-key')).toHaveCount(0);
});

test('MCP monitor against a 2026-07-28 server', async ({ page }) => {
  await login(page);
  await page.goto('/monitors/new');
  await page.getByRole('button', { name: 'MCP server' }).click();
  await page.getByLabel('Name').fill('Tool server');
  await page.getByLabel('MCP endpoint URL').fill(`${UP}/mcp-modern`);
  await page.getByLabel('Tools that must exist').fill('get_weather');
  await page.getByRole('button', { name: 'Test configuration' }).click();
  await expect(page.getByText(/Stateless MCP 2026-07-28/)).toBeVisible();
  await page.getByRole('button', { name: 'Create monitor' }).click();
  await expect(page.getByRole('heading', { name: /Tool server/ })).toBeVisible();
});

test('webhook channel test delivery', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Notifications' }).click();
  await page.getByRole('button', { name: 'Add channel' }).click();
  await page.getByLabel('Name').fill('Local sink');
  await page.getByLabel('URL').fill(`${UP}/hook`);
  await page.getByRole('button', { name: 'Add channel' }).click();
  await expect(page.getByText('Local sink')).toBeVisible();
  await page.getByRole('button', { name: 'Send test' }).click();
  await expect(page.getByText(/Test delivered \(HTTP 200\)/)).toBeVisible();
});

test('API token is shown once and works for the CI gate', async ({ page, request }) => {
  await login(page);
  await page.getByRole('link', { name: 'API tokens' }).click();
  await page.getByLabel('Token name').fill('ci');
  await page.getByRole('button', { name: 'Create token' }).click();
  const token = (await page.locator('.secret-token').textContent())?.trim() ?? '';
  expect(token).toMatch(/^tl_/);
  const gate = await request.get('/api/v1/gate?tags=payments', { headers: { authorization: `Bearer ${token}` } });
  expect(gate.status()).toBe(200);
  expect(await gate.json()).toMatchObject({ pass: true, evaluated: 1 });
  await page.getByRole('button', { name: 'I’ve stored it' }).click();
  await expect(page.locator('.secret-token')).toHaveCount(0);
});

test('viewer must change the initial password and cannot edit', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Users' }).click();
  await page.getByRole('button', { name: 'Add user' }).click();
  await page.getByLabel('Name').fill('Vic Viewer');
  await page.getByLabel('Email').fill('viewer@e2e.test');
  await page.getByLabel('Initial password').fill('initial-pass-1');
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByText('viewer@e2e.test')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  await login(page, 'viewer@e2e.test', 'initial-pass-1');
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.getByLabel('Current (temporary) password').fill('initial-pass-1');
  await page.getByLabel('New password', { exact: true }).fill('viewer-pass-123');
  await page.getByLabel('Confirm new password').fill('viewer-pass-123');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New monitor' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
});

test('@mobile navigation works without horizontal scrolling', async ({ page }) => {
  await login(page);
  await page.goto('/monitors');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: /Drift inbox/ }).click();
  await expect(page.getByRole('heading', { name: 'Upstream changes' })).toBeVisible();
});
