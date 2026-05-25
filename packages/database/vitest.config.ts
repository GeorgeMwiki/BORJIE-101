// Local vitest config so 'pnpm -C packages/database test' discovers
// the in-package test files. Without this, vitest falls back to the
// workspace-root config whose include glob only resolves when cwd is
// the repo root — running from inside this package returned
// "No test files found".
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15000,
  },
});
