import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // CI runs every package's tests in parallel; heavy jsdom/canvas a11y suites
    // can throw intermittent unhandled errors under CPU contention (this suite
    // passes in the per-package run, fails in the combined one). Retry in CI to
    // absorb load-induced flakiness — a genuinely broken test fails all retries.
    retry: process.env.CI ? 2 : 0,
    testTimeout: 15000,
  },
});
