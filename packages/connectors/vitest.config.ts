// Local vitest config so 'pnpm -C packages/connectors test' discovers
// the in-package test files. Without this, vitest falls back to the
// workspace-root config whose include glob only resolves when cwd is
// the repo root.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15000,
  },
});
