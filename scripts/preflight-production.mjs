#!/usr/bin/env node
// @ts-check
// =============================================================================
// Borjie — Production Env Preflight (LANE 2)
// =============================================================================
// ONE command that tells the founder EXACTLY which secret values are still
// needed before a production cutover. No app boot, no network, no deps.
//
// It reads the env (process.env, or a target `.env` file via --env) and prints:
//   - PRESENT  — every production-required value that is set
//   - MISSING  — every production-required value still absent, with a
//                copy-pasteable list of the missing keys
//   - a READY / NOT-READY verdict (exit 0 / 1)
//
// The required set is imported from scripts/lib/production-required.mjs, the
// SAME source the gateway's boot-time assertion mirrors
// (services/api-gateway/src/config/validate-env.ts) — so preflight and boot can
// never disagree about what "production-ready" means.
//
// Usage:
//   node scripts/preflight-production.mjs                 # check process.env
//   node scripts/preflight-production.mjs --env .env.local
//   node scripts/preflight-production.mjs --json          # machine-readable
//
// Exit codes:
//   0 — READY (every required value present)
//   1 — NOT-READY (>=1 required value missing) OR a fatal error (bad --env path)
// =============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRODUCTION_REQUIRED,
  partitionRequirements,
} from './lib/production-required.mjs';
import { parseEnvFile } from './lib/env-mutators.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

/**
 * parseFlags — minimal flag parser.
 * @param {ReadonlyArray<string>} argv
 * @returns {{ env: string | null, json: boolean, help: boolean }}
 */
export function parseFlags(argv) {
  const flags = { env: /** @type {string|null} */ (null), json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') flags.json = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else if (a === '--env') flags.env = argv[i + 1] ?? null;
    else if (a.startsWith('--env=')) flags.env = a.slice('--env='.length);
  }
  return flags;
}

/**
 * loadEnvSource — process.env, or a parsed `.env` file when `--env PATH` is
 * given. Throws on a bad path so the caller can exit non-zero loudly.
 *
 * @param {string | null} envPath
 * @returns {Record<string, string | undefined>}
 */
export function loadEnvSource(envPath) {
  if (!envPath) return process.env;
  const abs = isAbsolute(envPath) ? envPath : resolve(REPO_ROOT, envPath);
  // `abs` is an operator-supplied --env path for this local-only CLI tool;
  // there is no untrusted-input surface (no network, no request handling).
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!existsSync(abs)) {
    throw new Error(`--env file not found: ${abs}`);
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return parseEnvFile(readFileSync(abs, 'utf8'));
}

/**
 * buildReport — pure: the present/missing split + verdict for an env source.
 * @param {Record<string, string | undefined>} source
 */
export function buildReport(source) {
  const { present, missing } = partitionRequirements(source);
  return {
    ready: missing.length === 0,
    total: PRODUCTION_REQUIRED.length,
    present: present.map((r) => r.label),
    missing: missing.map((r) => ({ label: r.label, why: r.why })),
    missingKeys: missing.map((r) => r.label),
  };
}

function printHelp() {
  process.stdout.write(`preflight-production — production env readiness check.

Usage:
  node scripts/preflight-production.mjs [--env PATH] [--json]

Flags:
  --env PATH   read a target .env file instead of process.env
  --json       emit a machine-readable JSON report
  --help       show this message

Exit codes:
  0  READY      — every production-required value is present
  1  NOT-READY  — one or more required values missing (or fatal error)
`);
}

/** Human-readable console report. */
function printHuman(report) {
  const ok = (s) => `\x1b[32m${s}\x1b[0m`;
  const bad = (s) => `\x1b[31m${s}\x1b[0m`;
  const dim = (s) => `\x1b[2m${s}\x1b[0m`;

  console.log('Borjie — Production Env Preflight');
  console.log('='.repeat(60));
  console.log(`Required values: ${report.total}\n`);

  console.log(`PRESENT (${report.present.length}/${report.total}):`);
  if (report.present.length === 0) {
    console.log(dim('  (none)'));
  } else {
    for (const label of report.present) console.log(`  ${ok('OK')}  ${label}`);
  }

  console.log(`\nMISSING (${report.missing.length}/${report.total}):`);
  if (report.missing.length === 0) {
    console.log(dim('  (none)'));
  } else {
    for (const m of report.missing) {
      console.log(`  ${bad('--')}  ${m.label}`);
      console.log(dim(`        ${m.why}`));
    }
    console.log('\nCopy-paste missing keys:');
    console.log(`  ${report.missingKeys.join(' ')}`);
  }

  console.log('\n' + '='.repeat(60));
  if (report.ready) {
    console.log(ok('VERDICT: READY — every production-required value is present.'));
  } else {
    console.log(
      bad(
        `VERDICT: NOT-READY — ${report.missing.length} value(s) still needed.`,
      ),
    );
    console.log(
      dim(
        '  Paste each missing value, then run `node scripts/set-gh-secrets.mjs`\n' +
          '  to push the present secrets to GitHub Actions. See\n' +
          '  scripts/secrets/REQUIRED_SECRETS.md for how to obtain each value.',
      ),
    );
  }
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    process.exit(0);
  }

  let source;
  try {
    source = loadEnvSource(flags.env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (flags.json) {
      console.log(JSON.stringify({ ready: false, error: msg }, null, 2));
    } else {
      console.error(`Preflight failed: ${msg}`);
    }
    process.exit(1);
  }

  const report = buildReport(source);
  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
  process.exit(report.ready ? 0 : 1);
}

// Only run when invoked directly (not when imported by tests).
if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
