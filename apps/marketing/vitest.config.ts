/**
 * Vitest config for @borjie/marketing.
 *
 * The root vitest.config restricts include to `packages/**`,
 * `services/**`, and `scripts/**` — it deliberately excludes `apps/**`
 * so the per-app suites (with their own DOM/JSX needs) don't run under
 * the node-only root config. This file is the marketing app's own
 * config so its `src/**` tests (the Mode-C dead-links / form-route /
 * single-locale 404 / reachable-audience guards) actually run in CI.
 *
 * Mirrors apps/owner-web/vitest.config.ts:
 *  - jsdom because future tests will mount React marketing sections.
 *  - `@/*` → `src/*`, matching the Next.js tsconfig path mapping.
 *  - React 17+ automatic JSX runtime so components don't need an
 *    explicit `import React`.
 */
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [{ find: '@', replacement: path.resolve(__dirname, 'src') }],
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: [
      'src/**/__tests__/**/*.test.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
    ],
    testTimeout: 10000,
  },
});
