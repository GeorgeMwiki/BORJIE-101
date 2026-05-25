import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  // Keep node_modules + workspace packages unbundled. Node resolves them
  // at runtime via pnpm symlinks. Avoids esbuild choking on subpath
  // exports and dynamic requires in transitive deps (node-pre-gyp etc).
  //
  // NOTE: a follow-up to migrate api-gateway to ESM (or to bundle
  // workspace deps via `noExternal: [/^@borjie\//]`) is needed to
  // unblock the chronic-flaky E2E container failure — the CJS api-gateway
  // cannot synchronously `require()` ESM workspace packages. Bundling
  // surfaces ~10 pre-existing export mismatches that need closing first.
  skipNodeModulesBundle: true,
  external: [
    /^@borjie\//,
    '@mapbox/node-pre-gyp',
    'mock-aws-s3',
    'aws-sdk',
    'nock',
    'pg-native',
    'better-sqlite3',
  ],
  loader: {
    '.html': 'empty',
  },
});
