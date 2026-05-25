import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/schemas/index.ts',
    'src/repositories/index.ts',
  ],
  format: ['esm', 'cjs'],
  // dts generation fails against the drizzle v0.30 type surface until
  // we upgrade drizzle (tracked). package.json points `types` at
  // `./src/index.ts` so consumers get accurate types from source.
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['@borjie/domain-models'],
});
