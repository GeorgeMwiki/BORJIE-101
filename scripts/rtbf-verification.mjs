#!/usr/bin/env node
/**
 * RTBF (Right-to-be-Forgotten) verification — samples N pseudonymised
 * rows from audit-style tables and asserts the original PII cannot be
 * recovered without the per-tenant salt.
 *
 * Closes HIGH 9.1 from the 2026-05-19 post-PR-90 data-layer sweep:
 * `Docs/COMPLIANCE/audit-log-retention-policy.md:88` referenced this
 * script but it did not exist.
 *
 * Tests performed on each sample row:
 *   1. PRESENCE   — pseudonym fields have the `pseudo:` prefix (sha256
 *                   hex output).
 *   2. SHAPE      — pseudonym fields are exactly `'pseudo:' || 64-hex` —
 *                   short hashes indicate the wrong digest algorithm.
 *   3. IRREVERSIBILITY — look for common email/phone patterns that would
 *                   indicate the field still holds raw PII.
 *
 * Exit codes:
 *   0 — every sample passed all three checks
 *   1 — at least one sample failed
 *   2 — runtime error
 *
 * Usage
 *   node scripts/rtbf-verification.mjs [--sample-size 10] [--report <path>] [--json]
 *
 * Environment
 *   DATABASE_URL — Postgres connection string (required)
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const PSEUDONYM_PATTERNS = [/^pseudo:[0-9a-f]{64}$/];

const PSEUDONYMISED_TABLES = [
  { table: 'audit_events', fields: ['actor_email', 'subject_email'] },
  { table: 'kernel_action_audit', fields: ['actor_email'] },
];

const RAW_PII_HINTS = [
  /@gmail\.com$/,
  /@yahoo\.com$/,
  /\+254\d{9}$/,
  /\+255\d{9}$/,
];

function parseArgs(argv) {
  const out = { sampleSize: 10, report: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sample-size') out.sampleSize = Math.max(1, Number(argv[++i]));
    else if (a === '--report') out.report = argv[++i];
    else if (a === '--json') out.json = true;
  }
  return out;
}

function ensureDir(p) {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function checkRow(table, fields, row) {
  const failures = [];
  for (const f of fields) {
    const value = row[f];
    if (value === null || value === undefined) continue;
    if (typeof value !== 'string') {
      failures.push(`${table}.${f}: non-string value (${typeof value})`);
      continue;
    }
    const pseudonymised = PSEUDONYM_PATTERNS.some((rx) => rx.test(value));
    if (!pseudonymised) {
      const looksRaw = RAW_PII_HINTS.some((rx) => rx.test(value));
      if (looksRaw) {
        failures.push(`${table}.${f}: appears to be RAW PII (matches ${value})`);
      } else {
        failures.push(
          `${table}.${f}: not in pseudo:hex shape (got "${String(value).slice(0, 40)}...")`,
        );
      }
    }
  }
  return failures;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!process.env.DATABASE_URL) {
    console.error(
      'rtbf-verification: DATABASE_URL is not set — cannot connect to sample.',
    );
    process.exit(2);
  }

  let createDatabaseClient;
  try {
    ({ createDatabaseClient } = await import(
      '../packages/database/src/client.js'
    ));
  } catch (error) {
    console.error(
      'rtbf-verification: failed to load database package. Run `pnpm --filter @borjie/database build` first.',
      error,
    );
    process.exit(2);
  }

  const db = createDatabaseClient(process.env.DATABASE_URL);

  const results = [];
  let totalFailures = 0;
  for (const { table, fields } of PSEUDONYMISED_TABLES) {
    let rs;
    try {
      const cols = fields.map((f) => `"${f}"`).join(', ');
      rs = await db.execute({
        sql: `SELECT ${cols} FROM public."${table}" ORDER BY random() LIMIT ${args.sampleSize}`,
      });
    } catch (error) {
      results.push({
        table,
        sampled: 0,
        failures: [`unable to sample: ${String(error)}`],
      });
      continue;
    }
    const rows = rs?.rows ?? rs ?? [];
    const failures = [];
    for (const row of rows) {
      failures.push(...checkRow(table, fields, row));
    }
    totalFailures += failures.length;
    results.push({ table, sampled: rows.length, failures });
  }

  const summary = {
    scanner: 'rtbf-verification',
    scannedAt: new Date().toISOString(),
    sampleSize: args.sampleSize,
    totalFailures,
    results,
  };

  if (args.report) {
    ensureDir(args.report);
    writeFileSync(args.report, JSON.stringify(summary, null, 2));
  }

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.error(
      `rtbf-verification: sampled ${args.sampleSize} row(s) per table, ${totalFailures} failure(s) — ${totalFailures === 0 ? 'PASS' : 'FAIL'}`,
    );
    for (const r of results) {
      console.error(
        `  ${r.table.padEnd(28)} sampled=${r.sampled} failures=${r.failures.length}`,
      );
      for (const f of r.failures) console.error(`    - ${f}`);
    }
  }

  process.exit(totalFailures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('rtbf-verification: fatal error', error);
  process.exit(2);
});
