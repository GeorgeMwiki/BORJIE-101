/**
 * Tests — risk-scanner state resolver (scanner.ts `buildScannerState`).
 *
 * Guards the un-dark fixes on the risk scanner:
 *
 *   (a) RLS-DARKNESS — the brain tool binds `app.current_tenant_id` around
 *       the resolver reads (proven at the call-site in
 *       `risk-scanner-tools.ts`). Here we assert the resolver itself is a
 *       pure read over a stub db so the binding wrapper can drive it, and
 *       that a real (existing) table row resolves to a NON-NULL state field.
 *
 *   (b) WRONG COLUMN — several resolver queries referenced columns that do
 *       not exist on the shipped tables (`licences.expires_at`,
 *       `grievances.party_type`/`created_at`,
 *       `workforce_certifications.cert_kind`/`active`,
 *       `insurance_policies.policy_kind`,
 *       `succession_plans.last_reviewed_at`,
 *       `regulatory_filings.filing_kind`). A stub Postgres that rejects the
 *       legacy columns proves the fields resolve to REAL data only after the
 *       column fix (RED before → GREEN after).
 *
 *   (c) CRASH-SAFETY — a field whose backing table is genuinely absent
 *       degrades to `null` / its empty default WITHOUT throwing the whole
 *       scan; existing-table fields still return real values in the same run.
 *
 * The stub db reconstructs each query's text from drizzle's `queryChunks`
 * and behaves like a real Postgres:
 *   - a reference to a legacy (removed) column throws `column ... does not exist`
 *   - a query over a genuinely-missing relation throws `relation ... does not exist`
 *   - otherwise it returns the seeded rows for the target table
 */

import { describe, expect, it } from 'vitest';
import { buildScannerState } from '../scanner';
import type { RiskScannerDeps } from '../scanner';

// Tables the resolver reads that never shipped (no migration creates them).
// A query over any of these must reject like real Postgres — the resolver
// slice catches it and degrades to the field's empty default, never throwing
// the whole scan.
const MISSING_TABLES = [
  'accounts_receivable',
  'payroll_schedule',
  'production_mom_summary',
  'fuel_inventory',
  'equipment_failures',
  'workforce_separations',
  'royalty_drafts_with_trend',
  'regulator_status',
  'buyer_credit_signals',
  'supplier_quality_signals',
  'lbma_fix_summary',
  'fx_rates_intraday',
  'security_audit_events',
  'cda_milestones',
  'withholding_tax_summary',
  'tra_correspondence',
  'contracts',
  'contract_renewal_workflows',
  'disputes',
];

// Columns that were removed / never existed on the shipped tables. The
// resolver must not reference them; a real PG rejects them.
// NB: `expires_at` is a VALID column on workforce_certifications and
// insurance_policies — only `licences` uses `expiry_date`. So the licences
// mismatch is caught by the table-specific guard below, not this global list.
const LEGACY_COLUMNS = [
  'party_type', // grievances uses raised_by_kind
  'cert_kind', // workforce_certifications uses cert_code
  'policy_kind', // insurance_policies uses coverage_type
  'last_reviewed_at', // succession_plans uses last_review_at
  'filing_kind', // regulatory_filings uses filing_type
  'principal_owner_age_years', // no such column on succession_plans
  'penalty_accrual_tzs', // no such column on regulatory_filings
  'cash_flow_daily', // relation never shipped (burn now reads `costs`)
];

interface ChunkLike {
  readonly value?: ReadonlyArray<string>;
}

/** Reconstruct the SQL text from a drizzle `sql` template's queryChunks. */
function queryText(query: unknown): string {
  const chunks = (query as { queryChunks?: ReadonlyArray<unknown> })
    .queryChunks;
  if (!Array.isArray(chunks)) return String(query);
  return chunks
    .map((c) => {
      const chunk = c as ChunkLike;
      return Array.isArray(chunk?.value) ? chunk.value.join('') : '';
    })
    .join('');
}

type Seed = Record<string, ReadonlyArray<Record<string, unknown>>>;

/**
 * Build a stub db that mimics a FORCE-RLS Postgres closely enough to prove
 * the column + crash-safety fixes:
 *   - a query naming a legacy/removed column throws (RED for the old code).
 *   - a query over a genuinely-missing relation throws `relation does not exist`.
 *   - otherwise, the first EXISTING table named in the query drives the rows.
 *
 * NOTE: existing-table names (`sales`, `costs`, `sites`, `incidents`, ...)
 * are checked BEFORE the missing-table list so a query that legitimately
 * hits an existing table is not tripped by a coincidental substring.
 */
function makeStubDb(seed: Seed): RiskScannerDeps['db'] {
  const execute = async (query: unknown): Promise<unknown> => {
    const text = queryText(query);

    // Existing tables first — return seeded rows for whichever table the
    // query hits. A legacy-column reference on an existing table still
    // throws below because we check columns before returning… so guard the
    // column check first.
    for (const col of LEGACY_COLUMNS) {
      const re = new RegExp(`\\b${col}\\b`);
      if (re.test(text)) {
        throw new Error(`column "${col}" does not exist`);
      }
    }

    // Table-specific legacy column: `licences` uses `expiry_date`, so a
    // `licences` query referencing `expires_at` is the OLD (RED) code.
    if (/\blicences\b/.test(text) && /\bexpires_at\b/.test(text)) {
      throw new Error('column "expires_at" does not exist');
    }

    for (const [table, rows] of Object.entries(seed)) {
      const re = new RegExp(`\\b${table}\\b`);
      if (re.test(text)) {
        return { rows };
      }
    }

    // Genuinely-missing relation — real PG rejects it.
    for (const missing of MISSING_TABLES) {
      const re = new RegExp(`\\b${missing}\\b`);
      if (re.test(text)) {
        throw new Error(`relation "${missing}" does not exist`);
      }
    }

    return { rows: [] };
  };
  return { execute } as RiskScannerDeps['db'];
}

describe('risk-scanner resolver — buildScannerState', () => {
  const tenantId = 'tenant-risk-1';
  const now = () => new Date('2026-07-02T00:00:00.000Z');

  it('resolves an EXISTING-table field (licences) to NON-NULL real data', async () => {
    // licences row present → the NEMC EIA expiry field must resolve to the
    // real number of days. Under the OLD code (`expires_at`) the stub throws
    // and the field degrades to null (RED); after the fix (`expiry_date`)
    // the query succeeds and the field is non-null (GREEN).
    const db = makeStubDb({
      licences: [{ days_left: 42 }],
    });
    const state = await buildScannerState(tenantId, { db, now });
    expect(state.nemcEiaDaysToExpiry).toBe(42);
  });

  it('resolves the flagship cash runway from cash_balances + costs', async () => {
    // cash on hand = latest per-account balance; daily burn = SUM(costs)/30.
    // 9_000_000 TZS on hand, 3_000_000 TZS spent last 30d → burn 100k/day →
    // runway = 90 days. The flagship `cash.runway_below_90d` rule can only
    // fire once this field is non-null.
    const db = makeStubDb({
      cash_balances: [{ cash_total: 9_000_000 }],
      costs: [{ daily_burn: 100_000 }],
    });
    const state = await buildScannerState(tenantId, { db, now });
    expect(state.cashOnHandTzs).toBe(9_000_000);
    expect(state.cashRunwayDays).toBe(90);
  });

  it('resolves grievances via raised_by_kind / raised_at (not party_type)', async () => {
    const db = makeStubDb({ grievances: [{ grievance_count: 3 }] });
    const state = await buildScannerState(tenantId, { db, now });
    expect(state.csrGrievances60d).toBe(3);
  });

  it('resolves an expired-ICA count via cert_code / status (not cert_kind/active)', async () => {
    const db = makeStubDb({
      workforce_certifications: [{ expired_active: 2 }],
    });
    const state = await buildScannerState(tenantId, { db, now });
    expect(state.operatorsWithExpiredIcaActive).toBe(2);
  });

  it('resolves insurance expiry via coverage_type (not policy_kind)', async () => {
    const db = makeStubDb({
      insurance_policies: [
        { id: 'pol-1', coverage_type: 'plant', days_left: 20 },
      ],
    });
    const state = await buildScannerState(tenantId, { db, now });
    expect(state.insurancePoliciesExpiring30d).toHaveLength(1);
    expect(state.insurancePoliciesExpiring30d[0]?.policyKind).toBe('plant');
    expect(state.insurancePoliciesExpiring30d[0]?.daysToExpiry).toBe(20);
  });

  it('resolves succession review overdue via last_review_at (not last_reviewed_at)', async () => {
    const db = makeStubDb({
      succession_plans: [{ days_overdue: 400 }],
    });
    const state = await buildScannerState(tenantId, { db, now });
    expect(state.successionReviewOverdueDays).toBe(400);
    // No age column exists — the field stays null (no fabricated value).
    expect(state.principalOwnerAgeYears).toBeNull();
  });

  it('degrades a MISSING-table field to its empty default without throwing the scan', async () => {
    // Seed ONLY an existing table. Every missing-table field (e.g. AR%,
    // production MoM, buyer late payments) must degrade to its empty
    // default while the existing-table field still resolves in the SAME run.
    const db = makeStubDb({
      licences: [{ days_left: 10 }],
    });
    const state = await buildScannerState(tenantId, { db, now });
    // existing-table field: real value
    expect(state.nemcEiaDaysToExpiry).toBe(10);
    // missing-table fields: empty defaults, no throw
    expect(state.arOverdue60dPctOfMonthly).toBeNull();
    expect(state.productionMomMonthsDown).toBe(0);
    expect(state.buyerLatePayments).toEqual([]);
    expect(state.equipmentRepeatFailures).toEqual([]);
    expect(state.accessAnomaliesLastHour).toBe(0);
  });
});
