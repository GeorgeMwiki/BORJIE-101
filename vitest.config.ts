import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@borjie/domain-models': path.resolve(__dirname, 'packages/domain-models/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/**/*.test.ts',
      'services/**/*.test.ts',
      'scripts/**/*.test.ts',
      'scripts/**/*.test.mjs',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**/*.ts', 'services/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
    testTimeout: 10000,
  },
});
