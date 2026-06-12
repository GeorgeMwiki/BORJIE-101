import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  // No .d.ts: api-gateway is a PRIVATE, deployable leaf service (`node
  // dist/index.js`) with no `types` export and zero workspace consumers — the
  // generated 328-byte d.ts was never imported. Its DTS worker (~52s, rollup
  // over 1468 files) was also the sole OOM under a concurrent monorepo build.
  // Dropping it makes the build ~50x faster and OOM-proof; typecheck is still
  // enforced separately by `tsc --noEmit`.
  dts: false,
  clean: true,
  sourcemap: true,
  // Bundle the @borjie/* workspace packages INTO the api-gateway image
  // (noExternal), but keep third-party node_modules unbundled (Node resolves
  // them at runtime via pnpm symlinks). WHY: the api-gateway ships as a CJS
  // leaf service (`node dist/index.js`) and many workspace packages export raw
  // `./src/index.ts` (or ESM with `.js` specifiers that point at uncompiled
  // `.ts`). A plain Node runtime cannot `require()` those — the production
  // boot crashed with ERR_MODULE_NOT_FOUND on the first such import. Inlining
  // the workspace graph at build time removes that whole resolution class:
  // esbuild walks the real `.ts` sources and emits one self-contained bundle.
  //
  // `external` still excludes native/optional deps esbuild can't safely walk
  // (node-pre-gyp, aws-sdk mocks, pg-native, better-sqlite3).
  skipNodeModulesBundle: true,
  noExternal: [/^@borjie\//],
  external: [
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
