import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    // Server.ts and the repo factory have heavy import side effects
    // (express/pino + lazy `require('@borjie/database')`); cold-load
    // under parallel pressure can blow the default 10s hook budget.
    // Widen the per-hook timeout so beforeAll dynamic imports finish
    // even when the repo runs `pnpm -r test` across ~200 packages.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
