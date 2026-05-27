import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
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
  // SSR-safe: every heavy peer is dynamically imported inside useEffect
  // so Next.js 15.5 never evaluates them on the server.
  external: [
    'react',
    'react-dom',
    'virtua',
    '@dnd-kit/core',
    '@dnd-kit/sortable',
    '@borjie/graph-viz',
    '@borjie/genui',
    '@borjie/mutation-authority',
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
