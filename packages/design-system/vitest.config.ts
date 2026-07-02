import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Package-scoped vitest config for @borjie/design-system. jsdom env so the
 * React motion primitives (Reveal, useReducedMotion) can be rendered and their
 * matchMedia / IntersectionObserver behaviour exercised.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
