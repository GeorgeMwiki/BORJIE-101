import { defineConfig } from 'vitest/config';

/**
 * Package-scoped vitest config. Tests run in `node` because the hook
 * tests are exercised through mocked DOM globals rather than a real
 * jsdom environment — see the spec note about staying close to the
 * shape contract rather than coupling to React-testing-library.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/index.ts',
      ],
    },
  },
});
