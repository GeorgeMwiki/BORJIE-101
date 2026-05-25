import { defineConfig } from 'tsup';

/**
 * tsup config — declared per spec; default build still goes through
 * `tsc` to stay aligned with the rest of the monorepo. Wire `tsup` as
 * the build command later if/when we need dual ESM + CJS output.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
