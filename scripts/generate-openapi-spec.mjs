#!/usr/bin/env node
/**
 * generate-openapi-spec.mjs — emit `docs/openapi/borjie-mining.yaml`.
 *
 * Thin Node wrapper that shells out to `tsx` to run
 * `scripts/build-mining-openapi-spec.ts`. The TS builder owns the real
 * pipeline: it imports the `@hono/zod-openapi` route definitions
 * declared in `services/api-gateway/src/routes/mining/_openapi/route-defs.ts`
 * and emits the OpenAPI 3.1 document via
 * `@asteasolutions/zod-to-openapi`. Routes from the 26 files still
 * marked `// TODO(openapi-migration)` are regex-scraped as a fallback
 * (tracked in issue #60).
 *
 * History: previously this script was the pipeline itself (Option B
 * from the brief — regex over source, no AST). Issue #19 replaced it
 * with the first-class `zod-openapi` generator so response shapes,
 * SSE streams, and query schemas all surface in the YAML.
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const TS_ENTRY = resolve(__dirname, 'build-mining-openapi-spec.ts');
const TSX_BIN = resolve(REPO_ROOT, 'node_modules/.bin/tsx');

const child = spawn(TSX_BIN, [TS_ENTRY], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
