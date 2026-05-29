/**
 * Vitest config for @borjie/owner-web.
 *
 * The root vitest.config restricts include to `packages/**` and
 * `services/**`, so apps need their own. jsdom because future tests
 * will mount React components (SiteSelector, CeoModeSwitcher, etc.).
 *
 * Alias map:
 *  - `@/*` → `src/*` (matches the Next.js tsconfig path mapping).
 *  - `plyr` → a local stub. We add `plyr` as a runtime dependency in
 *    package.json but do NOT install it in CI for the report-player
 *    tests (the player lazy-imports Plyr inside a client effect; the
 *    test suite never exercises that path). Aliasing here lets Vite's
 *    pre-bundler resolve the dynamic `import('plyr')` without a real
 *    install.
 *  - `.css` modules in the reports directory → empty stub so jsdom
 *    does not try to parse Plyr's skin overrides.
 */
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      { find: 'plyr', replacement: path.resolve(__dirname, 'test-stubs/plyr.ts') },
      {
        find: /.*\/plyr-borjie\.css$/,
        replacement: path.resolve(__dirname, 'test-stubs/empty.ts'),
      },
    ],
  },
  // React 17+ automatic JSX runtime — matches the Next.js build so
  // components don't need `import React from 'react'` to render under
  // vitest.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, 'test-stubs/vitest-setup.ts')],
    include: [
      'src/**/__tests__/**/*.test.{ts,tsx}',
      '__tests__/**/*.test.{ts,tsx}',
    ],
    testTimeout: 10000,
  },
});
