#!/usr/bin/env node
// @ts-check
// =============================================================================
// Borjie — Set GitHub Actions Secrets (LANE 2)
// =============================================================================
// Pushes the production-required secrets that EXIST in the local env up to
// GitHub Actions, so the deploy pipeline has everything it needs. The founder's
// only job is to paste the secret VALUES into `.env.local` (or the shell env);
// this script does the rest.
//
// Safety contract (NEVER violated):
//   - A secret VALUE is NEVER printed, logged, or placed on a command line /
//     process argv. Each value is fed to `gh secret set <NAME>` via STDIN.
//   - Only keys that are present (non-empty) in the local env are set. Absent
//     keys are SKIPPED and listed by name (so the founder knows what's left).
//   - Idempotent: `gh secret set` overwrites in place; re-running is safe.
//
// The required set is imported from scripts/lib/production-required.mjs (the
// same source the gateway boot-assertion + preflight share), so this can never
// drift from "what production actually needs".
//
// Usage:
//   node scripts/set-gh-secrets.mjs                  # set present secrets
//   node scripts/set-gh-secrets.mjs --env .env.local # read values from a file
//   node scripts/set-gh-secrets.mjs --dry-run        # show what WOULD be set
//   node scripts/set-gh-secrets.mjs --repo owner/repo
//   node scripts/set-gh-secrets.mjs --env-name production  # GH Environment
//
// Exit codes:
//   0 — every present secret set (or dry-run completed)
//   1 — a `gh` invocation failed, `gh` is missing, or a bad --env path
// =============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { presentCanonicalKeys, PRODUCTION_REQUIRED } from './lib/production-required.mjs';
import { parseEnvFile } from './lib/env-mutators.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

/**
 * parseFlags — minimal flag parser.
 * @param {ReadonlyArray<string>} argv
 */
export function parseFlags(argv) {
  const flags = {
    env: /** @type {string|null} */ (null),
    repo: /** @type {string|null} */ (null),
    envName: /** @type {string|null} */ (null),
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else if (a === '--env') flags.env = argv[i + 1] ?? null;
    else if (a.startsWith('--env=')) flags.env = a.slice('--env='.length);
    else if (a === '--repo') flags.repo = argv[i + 1] ?? null;
    else if (a.startsWith('--repo=')) flags.repo = a.slice('--repo='.length);
    else if (a === '--env-name') flags.envName = argv[i + 1] ?? null;
    else if (a.startsWith('--env-name=')) flags.envName = a.slice('--env-name='.length);
  }
  return flags;
}

/**
 * loadEnvSource — process.env, or a parsed `.env` file via `--env PATH`.
 * @param {string | null} envPath
 * @returns {Record<string, string | undefined>}
 */
export function loadEnvSource(envPath) {
  if (!envPath) return process.env;
  const abs = isAbsolute(envPath) ? envPath : resolve(REPO_ROOT, envPath);
  if (!existsSync(abs)) throw new Error(`--env file not found: ${abs}`);
  return parseEnvFile(readFileSync(abs, 'utf8'));
}

/**
 * planSecrets — pure: split required keys into "to set" (present) and
 * "skipped" (absent). The concrete present env key is used (so if the operator
 * filled the `NEXT_PUBLIC_*` alias, that exact key is pushed).
 *
 * @param {Record<string, string | undefined>} source
 * @returns {{ toSet: ReadonlyArray<string>, skipped: ReadonlyArray<string> }}
 */
export function planSecrets(source) {
  const present = presentCanonicalKeys(source);
  const toSet = [...present];
  const skipped = PRODUCTION_REQUIRED
    .filter((req) => !req.keys.some((k) => present.includes(k)))
    .map((req) => req.label);
  return { toSet, skipped };
}

/**
 * ghArgs — build the `gh secret set` argv (value NOT included; fed via stdin).
 * @param {string} name
 * @param {{ repo: string | null, envName: string | null }} opts
 * @returns {string[]}
 */
export function ghArgs(name, opts) {
  const args = ['secret', 'set', name, '--body', '-']; // `-` ⇒ read value from stdin
  if (opts.repo) args.push('--repo', opts.repo);
  if (opts.envName) args.push('--env', opts.envName);
  return args;
}

/** Verify `gh` is installed + authenticated. */
function assertGhReady() {
  const ver = spawnSync('gh', ['--version'], { encoding: 'utf8' });
  if (ver.status !== 0) {
    throw new Error('GitHub CLI (`gh`) not found. Install: https://cli.github.com/');
  }
  const auth = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  if (auth.status !== 0) {
    throw new Error('`gh` is not authenticated. Run `gh auth login` first.');
  }
}

function printHelp() {
  process.stdout.write(`set-gh-secrets — push present production secrets to GitHub Actions.

Usage:
  node scripts/set-gh-secrets.mjs [--env PATH] [--repo owner/repo] [--env-name NAME] [--dry-run]

Flags:
  --env PATH        read values from a .env file instead of the shell env
  --repo owner/repo target repo (default: the repo for the current directory)
  --env-name NAME   set as a GitHub *Environment* secret (e.g. production)
  --dry-run         list what WOULD be set; touches nothing
  --help            show this message

Never prints a secret value. Absent keys are skipped and listed.
`);
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
    console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const { toSet, skipped } = planSecrets(source);

  console.log('Borjie — Set GitHub Actions Secrets');
  console.log('='.repeat(60));
  if (flags.repo) console.log(`Repo:        ${flags.repo}`);
  if (flags.envName) console.log(`Environment: ${flags.envName}`);
  console.log(`To set:      ${toSet.length}`);
  console.log(`Skipped:     ${skipped.length} (absent in local env)\n`);

  if (skipped.length > 0) {
    console.log('SKIPPED (paste these values, then re-run):');
    for (const k of skipped) console.log(`  -- ${k}`);
    console.log('');
  }

  if (toSet.length === 0) {
    console.log('Nothing to set — no required secrets present in the local env.');
    process.exit(0);
  }

  if (flags.dryRun) {
    console.log('DRY RUN — would set (values never shown):');
    for (const k of toSet) console.log(`  + ${k}`);
    process.exit(0);
  }

  try {
    assertGhReady();
  } catch (err) {
    console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  let failures = 0;
  for (const name of toSet) {
    const value = source[name];
    // Defensive: presentCanonicalKeys already filtered, but never push empty.
    if (typeof value !== 'string' || value.trim() === '') {
      console.log(`  skip ${name} (empty)`);
      continue;
    }
    // Value goes via STDIN only — never on argv, never printed.
    const res = spawnSync('gh', ghArgs(name, { repo: flags.repo, envName: flags.envName }), {
      input: value,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (res.status === 0) {
      console.log(`  set  ${name}`);
    } else {
      failures += 1;
      // gh's stderr may echo context but never our value (it was on stdin).
      const stderr = (res.stderr || '').trim();
      console.error(`  FAIL ${name}${stderr ? ` — ${stderr}` : ''}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  if (failures === 0) {
    console.log(`Done — ${toSet.length} secret(s) set.`);
    if (skipped.length > 0) {
      console.log(`${skipped.length} still absent (listed above).`);
    }
    process.exit(0);
  }
  console.error(`${failures} secret(s) failed to set. See errors above.`);
  process.exit(1);
}

// Only run when invoked directly (not when imported by tests).
if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
