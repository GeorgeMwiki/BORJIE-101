import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Package-scoped vitest config for @borjie/app-shell. jsdom env for the
 * React shell components (GenerativeSurfaceMount + the top bar / switcher).
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
