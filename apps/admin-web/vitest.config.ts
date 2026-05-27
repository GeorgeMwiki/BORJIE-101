/**
 * Vitest config for @borjie/admin-web.
 *
 * The root vitest.config restricts include to `packages/**` and
 * `services/**`, so apps need their own. We use jsdom because the
 * sensorium bus + handlers (Central Command Phase A C4) reach into
 * `document` / `window` to install DOM listeners.
 *
 * Initial scope: sensorium + lib helpers. Other surfaces (genui,
 * ag-ui-client, etc.) require optional deps that aren't always
 * installed; their tests opt in via their own include patterns once
 * a dev installs the matching package set.
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
      'src/lib/sensorium/__tests__/**/*.test.ts',
      'src/lib/sensorium/__tests__/**/*.test.tsx',
      // Central-Command Phase A — AG-UI client hook + helpers.
      'src/lib/__tests__/**/*.test.ts',
      // Central-Command Phase A — generative-UI primitive schemas (C3).
      // Schema tests run without optional UI deps installed; component
      // smoke-tests opt in once react-vega / react-leaflet / etc. land.
      'src/lib/genui/__tests__/**/*.test.ts',
      // Central-Command Phase B B5 — session-replay recorder + uploader
      // + PII mask. rrweb itself is dynamically imported; tests inject
      // their own factory so they pass without `pnpm install`.
      'src/lib/session-replay/__tests__/**/*.test.ts',
      // Wave PILOT-HITL — FeedbackButton (pilot in-app feedback widget)
      // smoke tests. jsdom render; submitter is injected so the test
      // never reaches the Supabase auth client.
      'src/components/__tests__/**/*.test.tsx',
    ],
    testTimeout: 10000,
  },
});
