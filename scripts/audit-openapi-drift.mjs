#!/usr/bin/env node
// =============================================================================
// audit-openapi-drift.mjs
// =============================================================================
// Runs `pnpm openapi:generate` and then `git diff --exit-code` against the
// canonical spec path. Fails if regeneration produced uncommitted changes,
// meaning the source code has drifted from the committed OpenAPI spec.
//
// Gracefully degrades when the pnpm script or spec file does not exist yet
// (returns exit 0 with a placeholder message) so this audit can ship before
// the openapi:generate script is implemented.
// =============================================================================

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const SPEC_PATH = 'docs/openapi/borjie-mining.yaml';
const PKG_JSON = join(REPO_ROOT, 'package.json');

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', ...opts });

const main = () => {
  if (!existsSync(PKG_JSON)) {
    console.log('[openapi-drift] PLACEHOLDER: no package.json found.');
    process.exit(0);
  }

  const pkgRaw = run('node', ['-e', `process.stdout.write(require('${PKG_JSON.replace(/\\/g, '\\\\')}').scripts ? JSON.stringify(require('${PKG_JSON.replace(/\\/g, '\\\\')}').scripts) : '{}')`]);
  const scripts = (() => {
    try {
      return JSON.parse(pkgRaw.stdout || '{}');
    } catch {
      return {};
    }
  })();

  if (!scripts['openapi:generate']) {
    console.log('[openapi-drift] PLACEHOLDER: package.json has no "openapi:generate" script.');
    console.log('[openapi-drift] Wire up the generator, then this audit will start enforcing drift.');
    process.exit(0);
  }

  console.log('[openapi-drift] running: pnpm openapi:generate');
  const gen = run('pnpm', ['openapi:generate'], { stdio: 'inherit' });
  if (gen.status !== 0) {
    console.error(`[openapi-drift] pnpm openapi:generate exited with ${gen.status}`);
    process.exit(gen.status ?? 1);
  }

  if (!existsSync(join(REPO_ROOT, SPEC_PATH))) {
    console.log(`[openapi-drift] PLACEHOLDER: ${SPEC_PATH} does not exist yet.`);
    process.exit(0);
  }

  console.log(`[openapi-drift] running: git diff --exit-code ${SPEC_PATH}`);
  const diff = run('git', ['diff', '--exit-code', '--', SPEC_PATH], { stdio: 'inherit' });
  if (diff.status !== 0) {
    console.error(`[openapi-drift] DRIFT: ${SPEC_PATH} differs from committed spec. Run "pnpm openapi:generate" and commit the result.`);
    process.exit(1);
  }

  console.log('[openapi-drift] OK - spec matches committed file.');
  process.exit(0);
};

main();
