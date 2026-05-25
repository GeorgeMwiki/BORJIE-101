import { defineConfig } from 'vitest/config';

/**
 * Piece N — package-scoped vitest config. Node environment; tests at
 * src/__tests__/*.test.ts. Coverage thresholds align with the 80%+
 * project-wide standard.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        'src/index.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
