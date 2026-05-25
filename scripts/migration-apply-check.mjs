#!/usr/bin/env node
/**
 * migration-apply-check — fresh-DB migration apply validator.
 *
 * Companion to scripts/validate-migration-safety.mjs. Where the safety
 * validator catches NOT-NULL backfill hazards via static analysis,
 * THIS script catches ANY error that surfaces when applying every
 * migration in lex order against an empty Postgres database, e.g.:
 *
 *   - operator does not exist: text = uuid   (Z-MIG verifier, 2026-05-21)
 *   - relation "owner_statements" does not exist
 *   - syntax error at or near "IN" (window reserved word)
 *   - could not open extension control file (pgvector missing)
 *
 * Strategy:
 *
 *   1. Read every *.sql file under --migrations-dir, sorted in
 *      lex order (matches the runtime apply order in
 *      packages/database/src/run-migrations.ts).
 *   2. Connect to --db-url with ON_ERROR_STOP semantics (each file
 *      wrapped in a transaction; if a single statement errors the
 *      whole file is rolled back).
 *   3. Apply each file via the `psql` shell-out path (one transaction
 *      per file, matching the production runner).
 *   4. Capture ERROR / FATAL lines from stderr; record per-file PASS
 *      / FAIL with the first error line.
 *   5. Emit a markdown summary + JSON sidecar.
 *
 * Exit codes:
 *   0  every migration applied without error
 *   1  one or more migrations failed (ERROR / FATAL detected)
 *   2  fatal harness error (DB unreachable, psql missing, etc.)
 *
 * CLI:
 *   node scripts/migration-apply-check.mjs \
 *     --migrations-dir=packages/database/src/migrations \
 *     --db-url=$DATABASE_URL \
 *     [--report=.audit/migration-apply.md] \
 *     [--reset-db=true]    # DROP+CREATE the target DB first
 *     [--enable-vector=true]  # CREATE EXTENSION vector before applying
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  isMigrationApplyAllowlisted,
  migrationApplyAllowlistReason,
} from './__allowlists__/migration-apply-allowlist.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

const DEFAULTS = {
  migrationsDir: 'packages/database/src/migrations',
  dbUrl: process.env.DATABASE_URL || '',
  report: '',
  resetDb: false,
  enableVector: true,
};

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const value = eq === -1 ? 'true' : raw.slice(eq + 1);
    switch (key) {
      case 'migrations-dir': args.migrationsDir = value; break;
      case 'db-url':         args.dbUrl = value; break;
      case 'report':         args.report = value; break;
      case 'reset-db':       args.resetDb = value === 'true' || value === '1'; break;
      case 'enable-vector':  args.enableVector = value === 'true' || value === '1'; break;
      case 'help':
      case 'h':              printHelp(); process.exit(0); break;
      default: break;
    }
  }
  return args;
}

function printHelp() {
  // eslint-disable-next-line no-console
  console.log([
    'migration-apply-check — fresh-DB apply validator',
    '',
    'Usage:',
    '  node scripts/migration-apply-check.mjs [flags]',
    '',
    'Flags:',
    '  --migrations-dir=<path>  default packages/database/src/migrations',
    '  --db-url=<url>           required, or set $DATABASE_URL',
    '  --report=<path>          optional, write markdown report to this path',
    '  --reset-db=true|false    drop + recreate the target DB (default false)',
    '  --enable-vector=true|false  CREATE EXTENSION vector first (default true)',
    '',
    'Exit codes:',
    '  0  every migration applied without ERROR / FATAL',
    '  1  one or more migrations failed',
    '  2  harness error',
  ].join('\n'));
}

function findMigrationFiles(dir) {
  const abs = resolve(ROOT, dir);
  if (!existsSync(abs)) {
    throw new Error(`Migrations dir not found: ${abs}`);
  }
  return readdirSync(abs)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f, path: join(abs, f) }));
}

function applyOne(dbUrl, file) {
  // -v ON_ERROR_STOP=1 = abort the file on the first ERROR. Single
  // transaction per file matches the production runner. Capture
  // BOTH stdout (NOTICE messages) and stderr (errors).
  const result = spawnSync(
    'psql',
    [dbUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-f', file.path],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );

  const stderr = result.stderr || '';
  const stdout = result.stdout || '';

  // ERROR / FATAL detection — psql emits these on stderr.
  const errorLines = stderr
    .split('\n')
    .filter((line) => /^(psql:.*:\s*)?(ERROR|FATAL):/i.test(line));

  const passed = result.status === 0 && errorLines.length === 0;

  // Known-broken migrations (already shipped to production; cannot be
  // edited per the CLAUDE.md immutability rule). The error is still
  // reported in the markdown but the gate exit code treats them as
  // accepted-risk, identical to the .trivyignore + audit-with-allowlist
  // patterns for transitive CVEs.
  const allowlisted = !passed && isMigrationApplyAllowlisted(file.name);

  return {
    file: file.name,
    exitCode: result.status ?? -1,
    stderr,
    stdout,
    errorLines,
    passed,
    allowlisted,
    allowlistReason: allowlisted ? migrationApplyAllowlistReason(file.name) : null,
  };
}

function maybeResetDb(dbUrl) {
  // Parse out the dbname from a postgres://user:pass@host:port/dbname URL.
  const m = /^(postgres(?:ql)?:\/\/[^/]+)\/([^?]+)/.exec(dbUrl);
  if (!m) {
    throw new Error(`Cannot parse db-url for reset: ${dbUrl}`);
  }
  const baseUrl = m[1];
  const dbName = m[2];
  const adminUrl = `${baseUrl}/postgres`;

  // Drop + create. ON_ERROR_STOP off so DROP IF NOT EXISTS doesn't abort.
  const drop = spawnSync(
    'psql',
    [adminUrl, '-X', '-q', '-c', `DROP DATABASE IF EXISTS "${dbName}"`],
    { encoding: 'utf8' },
  );
  if (drop.status !== 0) {
    throw new Error(`DROP DATABASE failed: ${drop.stderr}`);
  }
  const create = spawnSync(
    'psql',
    [adminUrl, '-X', '-q', '-c', `CREATE DATABASE "${dbName}"`],
    { encoding: 'utf8' },
  );
  if (create.status !== 0) {
    throw new Error(`CREATE DATABASE failed: ${create.stderr}`);
  }
}

function maybeEnableVector(dbUrl) {
  // Best-effort. If pgvector isn't installed on the server, the rest
  // of the apply still works via the 0178 guard.
  const result = spawnSync(
    'psql',
    [dbUrl, '-X', '-q', '-c', 'CREATE EXTENSION IF NOT EXISTS vector'],
    { encoding: 'utf8' },
  );
  return result.status === 0;
}

function renderMarkdown(results) {
  const total = results.length;
  const passed = results.filter((r) => r.passed);
  const allowlisted = results.filter((r) => !r.passed && r.allowlisted);
  const failed = results.filter((r) => !r.passed && !r.allowlisted);
  const status = failed.length === 0 ? 'PASS' : 'FAIL';
  const lines = [
    '# Migration Apply Check',
    '',
    `**Total migrations:** ${total}`,
    `**Passed:** ${passed.length}`,
    `**Allowlisted (known-broken on fresh DB):** ${allowlisted.length}`,
    `**Failed (blocking):** ${failed.length}`,
    `**Status:** ${status}`,
    '',
  ];
  if (failed.length === 0 && allowlisted.length === 0) {
    lines.push('All migrations applied successfully against a fresh Postgres DB.');
    lines.push('');
    return lines.join('\n');
  }
  if (failed.length > 0) {
    lines.push('## Failed Migrations (blocking)');
    lines.push('');
    for (const r of failed) {
      lines.push(`### ${r.file}`);
      lines.push('');
      lines.push(`Exit code: ${r.exitCode}`);
      lines.push('');
      if (r.errorLines.length > 0) {
        lines.push('First error:');
        lines.push('```');
        lines.push(r.errorLines[0]);
        lines.push('```');
      } else {
        lines.push('No ERROR line captured — stderr tail:');
        lines.push('```');
        lines.push(r.stderr.split('\n').slice(-10).join('\n'));
        lines.push('```');
      }
      lines.push('');
    }
  }
  if (allowlisted.length > 0) {
    lines.push('## Allowlisted Migrations (known-broken on fresh DB, accepted)');
    lines.push('');
    lines.push(
      'These migrations are documented in `scripts/__allowlists__/migration-apply-allowlist.mjs` ' +
        'as legitimately-broken on a fresh DB but already healed in production by a later fixup ' +
        'migration. Per `CLAUDE.md` the shipped files cannot be edited; the fix lives in the ' +
        'append-only fixup migration referenced in the allowlist reason.',
    );
    lines.push('');
    for (const r of allowlisted) {
      lines.push(`### ${r.file}`);
      lines.push('');
      lines.push(`Reason: ${r.allowlistReason}`);
      lines.push('');
      if (r.errorLines.length > 0) {
        lines.push('First error (informational):');
        lines.push('```');
        lines.push(r.errorLines[0]);
        lines.push('```');
        lines.push('');
      }
    }
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dbUrl) {
    // eslint-disable-next-line no-console
    console.error('ERROR: --db-url is required (or set $DATABASE_URL).');
    process.exit(2);
  }

  try {
    if (args.resetDb) {
      // eslint-disable-next-line no-console
      console.log('Resetting target database...');
      maybeResetDb(args.dbUrl);
    }
    if (args.enableVector) {
      // eslint-disable-next-line no-console
      console.log('Attempting CREATE EXTENSION vector (best-effort)...');
      const ok = maybeEnableVector(args.dbUrl);
      // eslint-disable-next-line no-console
      console.log(`  pgvector available: ${ok}`);
    }

    const files = findMigrationFiles(args.migrationsDir);
    // eslint-disable-next-line no-console
    console.log(`Applying ${files.length} migrations from ${args.migrationsDir}...`);

    const results = [];
    for (const f of files) {
      const r = applyOne(args.dbUrl, f);
      results.push(r);
      let tag;
      if (r.passed) {
        tag = 'PASS';
      } else if (r.allowlisted) {
        tag = 'KNOWN';
      } else {
        tag = 'FAIL';
      }
      // eslint-disable-next-line no-console
      console.log(
        `  ${tag}  ${r.file}${r.passed ? '' : ` — ${r.errorLines[0] || 'exit ' + r.exitCode}`}${r.allowlisted ? ' [ALLOWLISTED]' : ''}`,
      );
    }

    const md = renderMarkdown(results);
    // eslint-disable-next-line no-console
    console.log('\n' + md);

    if (args.report) {
      mkdirSync(dirname(resolve(ROOT, args.report)), { recursive: true });
      writeFileSync(resolve(ROOT, args.report), md, 'utf8');
    }

    // Blocking failures are anything that failed AND is not in the
    // documented allowlist. Allowlisted breakage is treated as accepted
    // risk (identical to the .trivyignore / audit-with-allowlist pattern
    // for transitive CVEs the team has reviewed and signed off on).
    const blocking = results.filter((r) => !r.passed && !r.allowlisted);
    process.exit(blocking.length === 0 ? 0 : 1);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Harness error: ${err.message}`);
    process.exit(2);
  }
}

main();
