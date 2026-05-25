import { defineConfig } from 'vitest/config';

/**
 * Package-scoped vitest config. Mirrors the sustainability-advisor
 * setup so per-package `src/__tests__` folders are discovered when
 * CWD is the package (the repo root config uses repo-relative include
 * patterns that miss our local tests).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
