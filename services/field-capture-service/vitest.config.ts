import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve the workspace `@borjie/geo-intelligence` to its SOURCE (not the
// built `dist/`) so tests always exercise the live pipeline — otherwise a
// stale `dist/` masks source-level behaviour (e.g. the KI-012
// pending_analysis fix lives in `src/capture/capture-pipeline.ts`).
const geoIntelligenceSrc = fileURLToPath(
  new URL('../../packages/geo-intelligence/src/index.ts', import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      '@borjie/geo-intelligence': geoIntelligenceSrc,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
