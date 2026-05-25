/**
 * Vitest config for @borjie/owner-web.
 *
 * The root vitest.config restricts include to `packages/**` and
 * `services/**`, so apps need their own. jsdom because future tests
 * will mount React components (SiteSelector, CeoModeSwitcher, etc.).
 *
 * Scope is intentionally narrow at bootstrap — empty include list
 * with `--passWithNoTests` keeps the workspace `pnpm test` green
 * until the first real spec lands.
 */
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    testTimeout: 10000,
  },
});
