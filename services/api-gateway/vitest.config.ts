import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Array form lets us mix exact-match regex aliases (so subpath
    // imports like `@borjie/ai-copilot/ai-native` are NOT
    // intercepted) with prefix-match string aliases.
    alias: [
      {
        find: '@borjie/domain-models',
        replacement: path.resolve(__dirname, '../../packages/domain-models/src/index.ts'),
      },
      {
        find: '@borjie/payments-ledger-service/arrears',
        replacement: path.resolve(__dirname, '../payments-ledger/src/arrears/index.ts'),
      },
      {
        find: '@borjie/ai-copilot/services/migration/parsers/parse-upload',
        replacement: path.resolve(
          __dirname,
          '../../packages/ai-copilot/src/services/migration/parsers/parse-upload.ts',
        ),
      },
      {
        find: '@borjie/domain-services/gamification',
        replacement: path.resolve(__dirname, '../domain-services/src/gamification/index.ts'),
      },
      {
        find: '@borjie/payments/providers/gepg',
        replacement: path.resolve(__dirname, '../payments/src/providers/gepg/index.ts'),
      },
      // Wave-K W-Data — exact-match aliases for the top-level barrels
      // of database + ai-copilot. Tests need the latest `classify`,
      // `listClassifications`, `createPrivacyBudgetComposerService`,
      // and `compileDsar` exports without a `pnpm build` round-trip.
      // The regex `$` anchors keep subpath imports
      // (`@borjie/ai-copilot/ai-native`, `@borjie/database/schemas`)
      // routing through package.json exports.
      {
        find: /^@borjie\/database$/,
        replacement: path.resolve(__dirname, '../../packages/database/src/index.ts'),
      },
      {
        find: /^@borjie\/ai-copilot$/,
        replacement: path.resolve(__dirname, '../../packages/ai-copilot/src/index.ts'),
      },
      // Central-Command Phase A — AG-UI emitter / types live in
      // packages/central-intelligence/src and must resolve from source
      // for tests to see the latest streaming surface without a
      // `pnpm build` round-trip. `$` anchor preserves subpath imports.
      {
        find: /^@borjie\/central-intelligence$/,
        replacement: path.resolve(__dirname, '../../packages/central-intelligence/src/index.ts'),
      },
      // Dynamic model registry — brain-llm-router subpath export.
      // Tests pull from source so they don't need a `pnpm build`
      // round-trip on brain-llm-router (which is zero-dep itself).
      {
        find: /^@borjie\/brain-llm-router\/dynamic-registry$/,
        replacement: path.resolve(__dirname, '../../packages/brain-llm-router/src/dynamic-registry/index.ts'),
      },
      // Wave PAY-1 — route the top-level payments-ledger barrel through
      // source so the new mpesa/stripe mock clients are visible in tests
      // without a `pnpm --filter @borjie/payments-ledger-service build`
      // round-trip. The `$` anchor preserves the subpath alias for
      // `@borjie/payments-ledger-service/arrears` above.
      {
        find: /^@borjie\/payments-ledger-service$/,
        replacement: path.resolve(__dirname, '../payments-ledger/src/index.ts'),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', '__tests__/**/*.test.ts'],
    pool: 'forks',
    server: {
      deps: {
        inline: ['@hono/node-server'],
      },
    },
    testTimeout: 10000,
  },
});
