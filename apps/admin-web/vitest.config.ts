/**
 * Vitest config for @borjie/admin-web.
 *
 * The root vitest.config restricts include to `packages/**`,
 * `services/**`, and `scripts/**` — it deliberately excludes `apps/**`,
 * so this app needs its own. We use jsdom because the sensorium bus +
 * handlers (Central Command Phase A C4) reach into `document` /
 * `window` to install DOM listeners and the component suites mount
 * React via `@testing-library/react`.
 *
 * Include is the general `src/**` test glob (mirroring
 * apps/owner-web/vitest.config.ts) rather than a curated per-directory
 * allowlist. The allowlist previously stranded
 * `src/app/persona-drift/__tests__/page.test.tsx` (no `src/app/**`
 * entry) — a silently-dark suite (KI-015). The broad glob discovers
 * every `__tests__` directory under `src` so a newly-added suite can
 * never go dark by living in an un-allowlisted folder.
 */
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      // Central-Command Phase A — load AG-UI emitter + types directly
      // from `packages/central-intelligence/src` so the client hook +
      // its tests pick up the latest streaming surface without a
      // `pnpm build` round-trip. Anchor with `$` so subpath imports
      // keep resolving via the package's exports map.
      {
        find: /^@borjie\/central-intelligence$/,
        replacement: path.resolve(
          __dirname,
          '../../packages/central-intelligence/src/index.ts',
        ),
      },
      // ProdFix-4 — load @borjie/genui from source so the schema
      // tests pick up the latest exports without requiring a `pnpm
      // build` of genui first. Without this, CI fresh-install lands
      // before the genui dist is built and vitest collects 0 tests
      // for the genui-schemas suite.
      {
        find: /^@borjie\/genui$/,
        replacement: path.resolve(
          __dirname,
          '../../packages/genui/src/index.ts',
        ),
      },
    ],
  },
  // React 17+ automatic JSX runtime so component tests (.tsx) don't need
  // `import React from 'react'`. Matches the Next.js build + owner-web's
  // vitest config.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: [
      // Every `__tests__` suite anywhere under `src` (sensorium, genui
      // schemas, session-replay, FeedbackButton, superpowers, HomeChat,
      // brain-api, the persona-drift page, etc.). All current suites run
      // without optional UI deps (react-vega / react-leaflet / rrweb):
      // schema tests cover contracts not components, and the dynamic-dep
      // suites inject their own factories. A future component smoke-test
      // that needs an uninstalled dep must guard its own import.
      'src/**/__tests__/**/*.test.{ts,tsx}',
    ],
    testTimeout: 10000,
  },
});
