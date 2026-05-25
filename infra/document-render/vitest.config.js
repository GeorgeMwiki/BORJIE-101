// Local vitest config so the three render-server unit tests run when
// invoked from `infra/document-render/`. The repo-root vitest config
// only targets `packages/**` / `services/**`; this stack lives under
// `infra/` and needs its own include glob.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/**/*.test.js'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
