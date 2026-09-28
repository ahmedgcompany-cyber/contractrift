import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // PGlite instances are memory-heavy; keep integration files from all running at once.
    // Against a shared real PostgreSQL (TEST_DATABASE_URL) files must run one at a time.
    maxWorkers: process.env.TEST_DATABASE_URL ? 1 : 4,
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
