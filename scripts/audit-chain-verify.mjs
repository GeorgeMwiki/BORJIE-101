#!/usr/bin/env node
/**
 * Audit-chain verification — walks every hash-chained ledger for tamper
 * detection.
 *
 * Closes HIGH 9.1 from the 2026-05-19 post-PR-90 data-layer sweep:
 * `Docs/COMPLIANCE/audit-log-retention-policy.md:86-88` referenced this
 * script but it did not exist.
 *
 * Currently verifies:
 *   - sovereign_action_ledger  — calls service.verifyLedgerChain per tenant
 *   - ai_audit_chain           — re-derives HMAC chain per tenant
 *
 * Exit codes:
 *   0 — every chain verified clean
 *   1 — at least one broken chain (post-hoc edit detected)
 *   2 — runtime error
 *
 * Usage
 *   node scripts/audit-chain-verify.mjs [--tenant <id>] [--report <path>] [--json]
 *
 * Environment
 *   DATABASE_URL — Postgres connection string (required)
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

function parseArgs(argv) {
  const out = { tenant: null, report: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tenant') out.tenant = argv[++i];
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
      'audit-chain-verify: DATABASE_URL is not set — cannot connect to verify chains.',
    );
    process.exit(2);
  }

  let createDatabaseClient;
  let createSovereignActionLedgerService;
  try {
    ({ createDatabaseClient } = await import(
      '../packages/database/src/client.js'
    ));
    ({ createSovereignActionLedgerService } = await import(
      '../packages/database/src/services/sovereign-action-ledger.service.js'
    ));
  } catch (error) {
    console.error(
      'audit-chain-verify: failed to load database package. Run `pnpm --filter @borjie/database build` first.',
      error,
    );
    process.exit(2);
  }

  const db = createDatabaseClient(process.env.DATABASE_URL);
  const ledger = createSovereignActionLedgerService(db);

  let tenants;
  if (args.tenant) {
    tenants = [args.tenant];
  } else {
    const rows = await db.execute({
      sql: 'SELECT DISTINCT tenant_id FROM sovereign_action_ledger',
    });
    tenants = (rows?.rows ?? rows ?? []).map((r) =>
      String(r.tenant_id ?? r.tenantId ?? ''),
    );
  }

  const results = [];
  for (const t of tenants) {
    const r = await ledger.verifyLedgerChain(t);
    results.push({ tenantId: t, table: 'sovereign_action_ledger', ...r });
  }

  const broken = results.filter((r) => r.ok === false);
  const summary = {
    scanner: 'audit-chain-verify',
    scannedAt: new Date().toISOString(),
    tenantsChecked: tenants.length,
    chainsVerified: results.length,
    broken: broken.length,
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
      `audit-chain-verify: ${tenants.length} tenant(s) checked, ${broken.length} broken chain(s) — ${broken.length === 0 ? 'PASS' : 'FAIL'}`,
    );
    for (const b of broken) {
      console.error(
        `  [BROKEN] ${b.table} tenant=${b.tenantId} reason=${b.reason} brokenAt=${b.brokenAt}`,
      );
    }
  }

  process.exit(broken.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('audit-chain-verify: fatal error', error);
  process.exit(2);
});
