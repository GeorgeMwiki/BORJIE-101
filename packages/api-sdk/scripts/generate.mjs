#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Generate TypeScript types from `Docs/api/openapi.generated.json`.
 *
 * Output: `src/types.ts` — exports `paths`, `components`, `operations` in the
 * shape expected by `openapi-fetch`/`openapi-typescript` consumers. The file
 * is then consumed by `src/client.ts` for a typed fetch wrapper.
 *
 * Usage:
 *   node scripts/generate.mjs
 *   pnpm -C packages/api-sdk generate
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PACKAGE_ROOT = resolve(__dirname, '..');
const MONOREPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
const DEFAULT_SPEC = resolve(MONOREPO_ROOT, 'Docs/api/openapi.generated.json');
const DEFAULT_OUT = resolve(PACKAGE_ROOT, 'src/types.ts');

async function loadOpenApiTypescript() {
  try {
    const mod = await import('openapi-typescript');
    return mod.default ?? mod;
  } catch (err) {
    console.error(
      '[api-sdk/generate] openapi-typescript is not installed. Run `pnpm install` in the monorepo root first.'
    );
    throw err;
  }
}

async function main() {
  const specPath = process.env.OPENAPI_SPEC_PATH || DEFAULT_SPEC;
  const outPath = process.env.OPENAPI_OUT_PATH || DEFAULT_OUT;

  // Surface a clear error if the spec is missing — this is usually because
  // `pnpm openapi:export` has not run yet.
  let specJson;
  try {
    specJson = JSON.parse(await readFile(specPath, 'utf8'));
  } catch (err) {
    console.error(`[api-sdk/generate] Unable to read OpenAPI spec at ${specPath}`);
    throw err;
  }

  const openapiTS = await loadOpenApiTypescript();

  // openapi-typescript v7 accepts either a URL/path or an inline object.
  const generated = await openapiTS(specJson);
  // Some openapi-typescript versions return an AST object — normalise to a
  // string. astToString was the v7 approach, falling back to .toString() for
  // older shapes.
  let source;
  try {
    const { astToString } = await import('openapi-typescript');
    source = typeof generated === 'string' ? generated : astToString(generated);
  } catch {
    source = typeof generated === 'string' ? generated : String(generated);
  }

  const banner = [
    '/**',
    ' * AUTO-GENERATED — do not edit by hand.',
    ' * Source: Docs/api/openapi.generated.json',
    ` * Generated: ${new Date().toISOString()}`,
    ' * Run `pnpm -C packages/api-sdk generate` to regenerate.',
    ' */',
    '',
    '/* eslint-disable */',
    '',
  ].join('\n');

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, banner + source, 'utf8');

  console.log(`[api-sdk/generate] wrote ${outPath} (${source.length.toLocaleString()} bytes)`);
}

main().catch((err) => {
  console.error('[api-sdk/generate] FAILED');
  console.error(err);
  process.exit(1);
});
