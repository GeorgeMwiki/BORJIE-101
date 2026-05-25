import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/types.ts', 'src/client.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
});
