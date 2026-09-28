import { defineConfig, devices } from '@playwright/test';

// E2E runs against the BUILT app (npm run build first) with a fresh in-memory database and the
// local test-substitute upstreams. Ports are unusual on purpose to avoid clashing with dev servers.
const APP_PORT = 3310;
const UPSTREAM_PORT = 4011;

export default defineConfig({
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'retain-on-failure',
    // PW_CHANNEL=chrome uses an installed Google Chrome instead of Playwright's Chromium build.
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  projects: [
    { name: 'desktop', testDir: 'tests/e2e', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
    { name: 'mobile', testDir: 'tests/e2e', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
    // Marketing screenshots: SCREENSHOTS=1 npx playwright test --project=screenshots
    ...(process.env.SCREENSHOTS ? [{ name: 'screenshots', testDir: 'tests/screenshots', use: { ...devices['Desktop Chrome'] } }] : []),
  ],
  webServer: [
    {
      command: 'npm run upstreams -w backend',
      url: `http://127.0.0.1:${UPSTREAM_PORT}/json`,
      env: { UPSTREAMS_PORT: String(UPSTREAM_PORT) },
      reuseExistingServer: false,
    },
    {
      command: 'node backend/dist/index.js',
      url: `http://localhost:${APP_PORT}/readyz`,
      env: {
        NODE_ENV: 'production',
        PORT: String(APP_PORT),
        APP_URL: `http://localhost:${APP_PORT}`,
        COOKIE_SECURE: 'false',
        PGLITE_DATA_DIR: 'memory://',
        ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
        ALLOW_PRIVATE_TARGETS: 'true',
        SCHEDULER_TICK_MS: '1000',
        // The suite signs in once per test from one IP; the production default is 10/min.
        AUTH_RATE_LIMIT_PER_MINUTE: '100',
        LOG_LEVEL: 'warn',
      },
      reuseExistingServer: false,
    },
  ],
});
