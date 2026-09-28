import { defineConfig } from 'vitest/config';

// Opt-in tests against real external services: npm run test:live -w backend
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/live/**/*.test.ts'],
    testTimeout: 200_000,
    fileParallelism: false,
  },
});
