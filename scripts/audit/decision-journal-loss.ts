/**
 * Decision Journal Loss Audit (G-FIX-4).
 *
 * Pre-fix window for the scope_ids text[] silent-drop bug:
 *   2026-05-29 01:02:20 +0300 (commit 2dc0fd90 — recorder introduced)
 *   → 2026-05-29 11:57:17 +0300 (commit 0214c417 — scope_ids cast fix)
 *
 * During this ~10h 55m window, drizzle's tagged-template interpolation
 * was binding scope_ids JS arrays as N positional params instead of one
 * text[]. Every recordDecision() call carrying ANY scope id tripped
 * postgres 22P02 "malformed array literal" and threw inside the writer.
 *
 * The bug was silent because:
 *   - DecisionRecorderError('persistence_failed') was emitted but not
 *     surfaced to the caller in some chat paths (brain tool wrappers
 *     catch and log via pino at warn level — no user-visible error).
 *   - Decisions without any scope_ids landed cleanly; rows missing
 *     scope_ids today look identical to "decision had no scopes" rows.
 *
 * Recovery posture (per CLAUDE.md immutability rule):
 *   - APPEND-ONLY. We never retroactively write rows to decisions.
 *   - The loss is disclosed in Docs/AUDIT/DECISION_JOURNAL_LOSS_RECOVERY.md.
 *   - Owners are notified bilingual sw/en via the dispatch surface so
 *     they can re-decide for the missing window if material.
 *
 * Run:
 *   pnpm tsx scripts/audit/decision-journal-loss.ts
 *
 * Requires:
 *   - DATABASE_URL or BORJIE_DATABASE_URL in env.
 *   - The script runs read-only — no DML, no DDL.
 *
 * Output:
 *   - Prints a JSON envelope to stdout with the rows-at-risk count and
 *     a per-tenant breakdown. Operators paste the count into the
 *     recovery doc rows-affected field.
 *   - Exits 0 on a clean read. Exits 1 if DB is unreachable / the
 *     decisions table is missing.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import pg from 'pg';

// Commit timestamps (UTC equivalents of +0300 local times).
const RECORDER_INTRODUCED_AT = '2026-05-28T22:02:20Z';
const SCOPE_IDS_FIX_AT = '2026-05-29T08:57:17Z';

interface AuditEnvelope {
  readonly windowFromUtc: string;
  readonly windowToUtc: string;
  readonly preFixCommit: string;
  readonly fixCommit: string;
  readonly totalRowsInWindow: number;
  readonly rowsWithEmptyScopeIds: number;
  readonly rowsWithEmptyScopeIdsAndEntityKindSuggestsScope: number;
  readonly estimatedLostRows: number;
  readonly perTenantBreakdown: ReadonlyArray<{
    tenantId: string;
    totalInWindow: number;
    emptyScopes: number;
  }>;
  readonly methodology: string;
  readonly recoveryDoc: string;
}

async function runAudit(): Promise<AuditEnvelope> {
  const databaseUrl =
    process.env.DATABASE_URL ??
    process.env.BORJIE_DATABASE_URL ??
    process.env.SUPABASE_DB_URL;

  if (!databaseUrl) {
    throw new Error(
      'decision-journal-loss audit: DATABASE_URL / BORJIE_DATABASE_URL / SUPABASE_DB_URL not set',
    );
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const total = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM decisions
        WHERE created_at >= $1::timestamptz
          AND created_at <= $2::timestamptz`,
      [RECORDER_INTRODUCED_AT, SCOPE_IDS_FIX_AT],
    );

    const emptyScopes = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM decisions
        WHERE created_at >= $1::timestamptz
          AND created_at <= $2::timestamptz
          AND COALESCE(array_length(scope_ids, 1), 0) = 0`,
      [RECORDER_INTRODUCED_AT, SCOPE_IDS_FIX_AT],
    );

    // Heuristic: an empty-scope row whose decision_subject_entity_kind
    // names a scope-shaped entity (site / pit / counterparty / licence)
    // is a strong indicator the row would have carried scope_ids if the
    // recorder had not silently dropped them on the failing INSERT.
    const emptyScopesEntityHinted = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM decisions
        WHERE created_at >= $1::timestamptz
          AND created_at <= $2::timestamptz
          AND COALESCE(array_length(scope_ids, 1), 0) = 0
          AND decision_subject_entity_kind IS NOT NULL
          AND decision_subject_entity_kind IN (
            'site', 'pit', 'counterparty', 'licence', 'shipment',
            'royalty_filing', 'supplier', 'project', 'asset'
          )`,
      [RECORDER_INTRODUCED_AT, SCOPE_IDS_FIX_AT],
    );

    const perTenant = await client.query<{
      tenant_id: string;
      total_in_window: string;
      empty_scopes: string;
    }>(
      `SELECT tenant_id,
              COUNT(*)::text AS total_in_window,
              COUNT(*) FILTER (
                WHERE COALESCE(array_length(scope_ids, 1), 0) = 0
              )::text AS empty_scopes
         FROM decisions
        WHERE created_at >= $1::timestamptz
          AND created_at <= $2::timestamptz
        GROUP BY tenant_id
        ORDER BY tenant_id`,
      [RECORDER_INTRODUCED_AT, SCOPE_IDS_FIX_AT],
    );

    const totalRowsInWindow = Number(total.rows[0]?.count ?? 0);
    const rowsWithEmptyScopeIds = Number(emptyScopes.rows[0]?.count ?? 0);
    const rowsWithEmptyScopeIdsAndEntityKindSuggestsScope = Number(
      emptyScopesEntityHinted.rows[0]?.count ?? 0,
    );

    // Conservative estimate: rows with empty scope_ids AND a scope-shaped
    // entity kind are very likely losses. Rows with empty scope_ids but
    // no entity hint may legitimately have had no scopes. We surface
    // both numbers so the operator can choose the disclosure bound.
    const estimatedLostRows = rowsWithEmptyScopeIdsAndEntityKindSuggestsScope;

    return Object.freeze({
      windowFromUtc: RECORDER_INTRODUCED_AT,
      windowToUtc: SCOPE_IDS_FIX_AT,
      preFixCommit: '2dc0fd90',
      fixCommit: '0214c417',
      totalRowsInWindow,
      rowsWithEmptyScopeIds,
      rowsWithEmptyScopeIdsAndEntityKindSuggestsScope,
      estimatedLostRows,
      perTenantBreakdown: perTenant.rows.map((row) =>
        Object.freeze({
          tenantId: row.tenant_id,
          totalInWindow: Number(row.total_in_window),
          emptyScopes: Number(row.empty_scopes),
        }),
      ),
      methodology:
        'Read-only count of decisions rows in pre-fix window. Lost rows = empty scope_ids AND scope-shaped entity kind. Counts represent SURVIVING rows that look suspect; actual loss count is unknowable because failed INSERTs left no row.',
      recoveryDoc: 'Docs/AUDIT/DECISION_JOURNAL_LOSS_RECOVERY.md',
    });
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  try {
    const result = await runAudit();
    const json = JSON.stringify(result, null, 2);
    process.stdout.write(`${json}\n`);
    const outPath = resolve(
      process.cwd(),
      'Docs/AUDIT/DECISION_JOURNAL_LOSS_RECOVERY.audit-output.json',
    );
    writeFileSync(outPath, `${json}\n`, 'utf8');
    process.stdout.write(`\nWrote: ${outPath}\n`);
  } catch (err) {
    process.stderr.write(
      `decision-journal-loss audit failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

void main();
