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
  // All viz libs are peer deps and dynamically imported in useEffect so
  // SSR consumers (Next.js 15.5) never try to evaluate them on the server.
  external: [
    'react',
    'react-dom',
    'cytoscape',
    'reactflow',
    'sigma',
    'graphology',
    'vis-network',
    'd3',
    'd3-sankey',
    'echarts',
    'echarts-for-react',
    '@borjie/genui',
    '@borjie/forecasting',
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
