import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      // Exclude pure I/O adapters (storage repositories, the cron
      // scheduler, the entrypoint wiring, and the shared types/config
      // re-exports). These are exercised by integration tests against
      // a live postgres + redis. Decision logic, validators, and the
      // nightly orchestrator are the load-bearing units we cover here.
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/storage/**',
        'src/cron/**',
        'src/types.ts',
      ],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 70,
        statements: 75,
      },
    },
  },
});
