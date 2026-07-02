import { defineConfig } from 'vitest/config';

/**
 * Scoped vitest project for the barrier mutation sentinel. Runs ONLY the
 * critical-barrier mutation test (money path, audit hash-chain, kill-switch
 * fail-closed) — deliberately narrow, per CLAUDE.md: mutation discipline is
 * applied to the load-bearing invariants, not the whole repo.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/ci/mutation-barriers/**/*.mutation.test.ts'],
    testTimeout: 10000,
  },
});
