import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'tenant/index': 'src/tenant/index.ts',
    'property/index': 'src/property/index.ts',
    'lease/index': 'src/lease/index.ts',
    'payment/index': 'src/payment/index.ts',
    'maintenance/index': 'src/maintenance/index.ts',
  },
  format: ['cjs', 'esm'],
  // dts generation is delegated to `tsc --declaration --emitDeclarationOnly`
  // via the package's `build:types` script (see package.json). tsup's
  // rollup-based dts emitter trips on our composite project config.
  dts: false,
  clean: true,
  splitting: false,
  sourcemap: true,
  treeshake: true,
});
