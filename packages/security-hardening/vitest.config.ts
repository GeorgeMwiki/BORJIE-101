import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    globals: false,
    testTimeout: 5000,
    hookTimeout: 5000,
  },
});
