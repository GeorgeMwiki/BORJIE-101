#!/usr/bin/env node
// =============================================================================
// audit-regulator-pack-drift.mjs
// =============================================================================
// Greps Docs/regulator-pack/tz/*.md for cited URLs and ISO dates, then checks
// that each citation has been touched in the last 180 days. Fails CI if any
// citation is older than 180 days (warn at 90).
//
// CURRENT STATE: placeholder pass-through that exits 0. Wire up the real
// citation parser + date-diff check in a follow-up phase. The workflow at
// .github/workflows/borjie-regulator-pack-drift.yml depends on this file
// existing so CI can run today.
// =============================================================================

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const PACK_DIR = join(REPO_ROOT, 'Docs', 'regulator-pack', 'tz');

const main = () => {
  const summary = {
    auditedFiles: 0,
    citationsFound: 0,
    stale90d: 0,
    stale180d: 0,
  };

  if (!existsSync(PACK_DIR)) {
    console.log(`[regulator-pack-drift] PLACEHOLDER: ${PACK_DIR} not present yet.`);
    console.log('[regulator-pack-drift] exit 0 (no-op pass-through).');
    process.exit(0);
  }

  const entries = readdirSync(PACK_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(PACK_DIR, name))
    .filter((path) => statSync(path).isFile());

  summary.auditedFiles = entries.length;
  console.log(`[regulator-pack-drift] PLACEHOLDER scan over ${summary.auditedFiles} file(s).`);
  console.log('[regulator-pack-drift] Real citation parsing + date-diff check NOT yet implemented.');
  console.log(`[regulator-pack-drift] summary=${JSON.stringify(summary)}`);
  console.log('[regulator-pack-drift] exit 0 (placeholder).');
  process.exit(0);
};

main();
