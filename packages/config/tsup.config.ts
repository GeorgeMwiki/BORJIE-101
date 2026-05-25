import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/schemas.ts', 'src/constants.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
});
