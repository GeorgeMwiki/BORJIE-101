/**
 * Integration test configuration.
 *
 * Differs from `vitest.config.ts` in three ways:
 *   1. Scope is `test/integration/**` — these tests touch real Postgres.
 *   2. `globalSetup` creates+migrates the throwaway `borjie_test`
 *      database once per run; `globalTeardown` drops it.
 *   3. Timeout is raised to 30s because each test pings the DB +
 *      HTTP stack; some flows (migration commit) insert dozens of rows.
 *
 * Tests run serially (`singleFork`) — truncating a shared database
 * between parallel workers would race and cause flaky isolation
 * checks. For speed we only run one fork.
 */

import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@borjie/domain-models': path.resolve(
        __dirname,
        '../../packages/domain-models/src/index.ts'
      ),
      '@borjie/payments-ledger-service/arrears': path.resolve(
        __dirname,
        '../payments-ledger/src/arrears/index.ts'
      ),
      '@borjie/ai-copilot/services/migration/parsers/parse-upload':
        path.resolve(
          __dirname,
          '../../packages/ai-copilot/src/services/migration/parsers/parse-upload.ts'
        ),
      '@borjie/domain-services/gamification': path.resolve(
        __dirname,
        '../domain-services/src/gamification/index.ts'
      ),
      '@borjie/payments/providers/gepg': path.resolve(
        __dirname,
        '../payments/src/providers/gepg/index.ts'
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.int.test.ts'],
    setupFiles: ['./test/integration/helpers/test-env.ts'],
    globalSetup: ['./test/integration/helpers/global-setup.ts'],
    // Force a single fork — tests share one Postgres DB.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
    sequence: { concurrent: false },
    server: {
      deps: {
        inline: ['@hono/node-server'],
      },
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
