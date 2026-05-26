import { defineConfig } from 'tsup';

/**
 * tsup build for `@borjie/agent-security-guard`.
 *
 * Outputs ESM + d.ts. Source maps included for forensic replay during
 * incident response (severity HIGH/CRITICAL signals frequently require
 * exact stack-trace lookup).
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  outDir: 'dist',
});
