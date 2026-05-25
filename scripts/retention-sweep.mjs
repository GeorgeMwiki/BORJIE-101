#!/usr/bin/env node
/**
 * Retention sweep — finds rows past their statute-prescribed retention
 * window and emits a report. Does NOT delete unless `--apply` is passed.
 *
 * Closes HIGH 9.1 from the 2026-05-19 post-PR-90 data-layer sweep:
 * `Docs/COMPLIANCE/audit-log-retention-policy.md:87` referenced this
 * script but it did not exist.
 *
 * Retention catalogue mirrors audit-log-retention-policy.md:
 *   - audit_events / sovereign_action_ledger / kernel_action_audit → permanent
 *   - tax_filings, kyc_events, payment_transactions, gepg_transactions → 7 years
 *   - messages / message_instances → 365 days
 *   - voice_turns → 90 days
 *   - webhook_deliveries → 30 days
 *
 * Exit codes:
 *   0 — no rows past retention OR --apply succeeded
 *   1 — eligible rows exist and --apply was NOT passed (dry-run informational)
 *   2 — runtime error
 *
 * Usage
 *   node scripts/retention-sweep.mjs            # dry-run
 *   node scripts/retention-sweep.mjs --apply    # delete (where allowed)
 *
 * Environment
 *   DATABASE_URL — Postgres connection string (required)
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const RETENTION = [
  { table: 'audit_events', retentionDays: null, deletionMode: 'pseudonymise-on-rtbf' },
  { table: 'sovereign_action_ledger', retentionDays: null, deletionMode: 'never' },
  { table: 'kernel_actions', retentionDays: null, deletionMode: 'pseudonymise-on-rtbf' },
  { table: 'kernel_action_audit', retentionDays: null, deletionMode: 'pseudonymise-on-rtbf' },
  { table: 'tax_filings', retentionDays: 365 * 7, deletionMode: 'delete' },
  { table: 'kyc_events', retentionDays: 365 * 7, deletionMode: 'delete' },
  { table: 'payment_transactions', retentionDays: 365 * 7, deletionMode: 'delete' },
  { table: 'gepg_transactions', retentionDays: 365 * 7, deletionMode: 'delete' },
  { table: 'message_instances', retentionDays: 365, deletionMode: 'delete' },
  { table: 'messages', retentionDays: 365, deletionMode: 'delete' },
  { table: 'voice_turns', retentionDays: 90, deletionMode: 'delete' },
  { table: 'webhook_deliveries', retentionDays: 30, deletionMode: 'delete' },
];

function parseArgs(argv) {
  const out = { apply: false, report: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--report') out.report = argv[++i];
    else if (a === '--json') out.json = true;
  }
  return out;
}

function ensureDir(p) {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv);

  if (!process.env.DATABASE_URL) {
    console.error(
      'retention-sweep: DATABASE_URL is not set — cannot connect to sweep retention.',
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
      'retention-sweep: failed to load database package. Run `pnpm --filter @borjie/database build` first.',
      error,
    );
    process.exit(2);
  }

  const db = createDatabaseClient(process.env.DATABASE_URL);

  const results = [];
  for (const policy of RETENTION) {
    if (policy.retentionDays === null) {
      results.push({
        ...policy,
        eligibleCount: 0,
        threshold: null,
        action: 'skipped — permanent retention',
      });
      continue;
    }

    const thresholdSql = `now() - interval '${policy.retentionDays} days'`;
    const timeColCandidates = ['created_at', 'recorded_at', 'captured_at', 'occurred_at'];

    let counted = 0;
    let timeCol = null;
    for (const col of timeColCandidates) {
      try {
        const rs = await db.execute({
          sql: `SELECT count(*)::bigint AS c FROM public."${policy.table}" WHERE "${col}" < ${thresholdSql}`,
        });
        const row = (rs?.rows ?? rs ?? [])[0];
        counted = Number(row?.c ?? row?.count ?? 0);
        timeCol = col;
        break;
      } catch {
        // column doesn't exist on this table — try next
      }
    }

    if (timeCol === null) {
      results.push({
        ...policy,
        eligibleCount: 0,
        threshold: thresholdSql,
        action: 'skipped — no time column found',
      });
      continue;
    }

    let action = `dry-run — ${counted} row(s) eligible (column ${timeCol})`;
    if (args.apply && policy.deletionMode === 'delete' && counted > 0) {
      try {
        await db.execute({
          sql: `DELETE FROM public."${policy.table}" WHERE "${timeCol}" < ${thresholdSql}`,
        });
        action = `deleted — ${counted} row(s) past retention (column ${timeCol})`;
      } catch (error) {
        action = `error during delete: ${String(error)}`;
      }
    }

    results.push({
      ...policy,
      eligibleCount: counted,
      threshold: thresholdSql,
      action,
    });
  }

  const eligibleTotal = results.reduce((acc, r) => acc + (r.eligibleCount ?? 0), 0);

  const summary = {
    scanner: 'retention-sweep',
    mode: args.apply ? 'apply' : 'dry-run',
    scannedAt: new Date().toISOString(),
    eligibleTotal,
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
      `retention-sweep [${summary.mode}]: ${eligibleTotal} row(s) past retention across ${results.length} table(s)`,
    );
    for (const r of results) {
      console.error(`  ${r.table.padEnd(28)} retention=${r.retentionDays ?? 'permanent'} eligible=${r.eligibleCount} action=${r.action}`);
    }
  }

  process.exit(args.apply || eligibleTotal === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('retention-sweep: fatal error', error);
  process.exit(2);
});
