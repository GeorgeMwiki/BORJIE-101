import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    seed: 'src/seed/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: {
    compilerOptions: {
      skipLibCheck: true,
      verbatimModuleSyntax: false,
      exactOptionalPropertyTypes: false,
      noUncheckedIndexedAccess: false,
      lib: ['ES2022', 'DOM'],
      types: ['react', 'react-dom', 'node'],
    },
  },
  clean: true,
  splitting: false,
  sourcemap: true,
  treeshake: true,
  external: [
    'react',
    'react-dom',
    '@tanstack/react-query',
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
