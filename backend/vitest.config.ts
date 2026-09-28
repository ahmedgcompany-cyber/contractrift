import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // PGlite instances are memory-heavy; keep integration files from all running at once.
    maxWorkers: 4,
  },
});
