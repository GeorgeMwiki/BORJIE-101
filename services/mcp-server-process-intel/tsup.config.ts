import { defineConfig } from 'tsup';

/**
 * tsup config for `@borjie/mcp-server-process-intel`.
 *
 * tsup is not currently a workspace dependency — this file is kept as
 * scaffolding so that `pnpm dlx tsup` (or a future workspace install)
 * produces a single-file bundle suitable for the Docker stage-2 image.
 * Day-to-day builds go through `tsc` via the `build` script.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  shims: false,
  platform: 'node',
  external: ['@modelcontextprotocol/sdk'],
});
