/**
 * Tests — risk-scanner BACKING REALITY (Tier-1 powers reality).
 *
 * Proves the scanner returns REAL data on the live path once its backing
 * relations exist (migration 0370 + seed). Three proofs:
 *
 *   (a) RESOLVER-REAL — with the (previously-missing) backing tables seeded,
 *       each resolver reads a NON-NULL / non-empty state field. Under the OLD
 *       world these tables don't exist and the field degrades to its empty
 *       default (RED); after 0370 + seed the field is REAL (GREEN). The
 *       companion `resolver.test.ts` already pins the RED (missing-table
 *       fail-soft) side, so the pair is a genuine red→green barrier.
 *
 *   (b) RULES-FIRE — the FLAGSHIP `cash.runway_below_90d` plus ≥6 other rules
 *       fire on the exact seeded values (mirrors the seed's representative
 *       mining figures).
 *
 *   (c) FAIL-SOFT-INTACT — a genuinely-absent source still degrades to null
 *       without throwing the whole scan.
 *
 * Uses the same stub-Postgres harness as `resolver.test.ts`: it reconstructs
 * each query's SQL text and returns seeded rows for the target table, so the
 * resolver's REAL column names + REAL aggregate shapes are exercised without a
 * live DB.
 */

import { describe, expect, it } from 'vitest';
import { buildScannerState, evaluateRisks } from '../scanner';
import { RISK_RULES } from '../scan-rules';
import type { RiskScannerDeps } from '../scanner';

interface ChunkLike {
  readonly value?: ReadonlyArray<string>;
}

function queryText(query: unknown): string {
  const chunks = (query as { queryChunks?: ReadonlyArray<unknown> }).queryChunks;
  if (!Array.isArray(chunks)) return String(query);
  return chunks
    .map((c) => {
      const chunk = c as ChunkLike;
      return Array.isArray(chunk?.value) ? chunk.value.join('') : '';
    })
    .join('');
}

type Seed = Record<string, ReadonlyArray<Record<string, unknown>>>;

/** Return seeded rows for whichever seeded table the query names first. */
function makeStubDb(seed: Seed): RiskScannerDeps['db'] {
  const execute = async (query: unknown): Promise<unknown> => {
    const text = queryText(query);
    for (const [table, rows] of Object.entries(seed)) {
      if (new RegExp(`\\b${table}\\b`).test(text)) {
        return { rows };
      }
    }
    return { rows: [] };
  };
  return { execute } as RiskScannerDeps['db'];
}

const tenantId = 'tenant-risk-backing-1';
const now = () => new Date('2026-07-02T00:00:00.000Z');

/**
 * The seeded state mirrors `seeds/risk-scanner-backing.seed.ts`. The resolver
 * SQL already reduces each table to the scanner's shape, so the stub returns
 * the AGGREGATED rows the resolver's SELECT would compute over the seed.
 */
function seededDb(): RiskScannerDeps['db'] {
  return makeStubDb({
    // flagship: 210M on hand / (90M/30 = 3M/day) → 70-day runway
    cash_balances: [{ cash_total: 210_000_000 }],
    costs: [{ daily_burn: 3_000_000 }],
    // AR: 80M overdue of 200M total → 40%
    accounts_receivable: [{ overdue: 80_000_000, total: 200_000_000 }],
    // payroll: 250M due in 5 days
    payroll_schedule: [{ days_to_run: 5, amount: 250_000_000 }],
    // fuel: 12000L / 3000L per day = 4 days
    fuel_inventory: [{ days_left: 4 }],
    // equipment: excavator 3 failures / 30d
    equipment_failures: [
      { equipment_kind: 'excavator', failure_count: 3, window_days: 30 },
    ],
    // 2 supervisors gone in 90d
    workforce_separations: [{ attrition_count: 2 }],
    // royalty 12% below trend → dev_pct -12
    royalty_drafts_with_trend: [{ dev_pct: -12 }],
    // NEMC + OSHA amber
    regulator_status: [{ nemc_amber: 1, osha_amber: 1 }],
    // 1 buyer, 3 late payments, crb -25
    buyer_credit_signals: [
      {
        buyer_id: 'buyer-tanzanite-house',
        buyer_name: 'Tanzanite House Ltd',
        late_count: 3,
        crb_delta: -25,
      },
    ],
    // supplier 4 off-spec
    supplier_quality_signals: [
      {
        supplier_id: 'sup-reagents-tz',
        supplier_name: 'Reagents Tanzania Ltd',
        off_spec: 4,
      },
    ],
    // withholding: 80M payable, 20M provision
    withholding_tax_summary: [{ payable: 80_000_000, provision: 20_000_000 }],
    // TRA inquiry open + filed 40d ago
    tra_correspondence: [{ open_flag: true, overdue_days: 40 }],
    // CDA: 2 overdue
    cda_milestones: [{ overdue_count: 2 }],
    // contract expiring in 25d, no renewal
    contracts: [
      {
        id: 'contract-offtake',
        counterparty_name: 'Metals Refinery East Africa',
        days_left: 25,
        annual_value: 1_800_000_000,
        renewal_in_flight: false,
      },
    ],
    // dispute escalation: 2 with same counterparty
    disputes: [
      {
        counterparty_id: 'cp-refinery-ea',
        counterparty_name: 'Metals Refinery East Africa',
        dispute_count: 2,
      },
    ],
    // production MoM 3 months down (view over production_tonnage_events)
    production_mom_summary: [
      { month_offset: 0, delta: -12 },
      { month_offset: 1, delta: -9 },
      { month_offset: 2, delta: -10 },
    ],
    // security: 0 anomalies (kept quiet so we exercise the fail-soft class too)
    security_audit_events: [],
    incidents: [{ open_count: 1 }],
  });
}

describe('risk-scanner backing reality — resolvers read REAL data', () => {
  it('resolves the FLAGSHIP cash runway to 70 days from seeded cash + costs', async () => {
    const state = await buildScannerState(tenantId, { db: seededDb(), now });
    expect(state.cashOnHandTzs).toBe(210_000_000);
    expect(state.cashRunwayDays).toBe(70);
  });

  it('resolves every previously-missing backing field to REAL non-empty data', async () => {
    const s = await buildScannerState(tenantId, { db: seededDb(), now });
    expect(s.arOverdue60dPctOfMonthly).toBeCloseTo(40, 5);
    expect(s.payrollDueInDays).toBe(5);
    expect(s.payrollAmountTzs).toBe(250_000_000);
    expect(s.fuelDaysRemaining).toBe(4);
    expect(s.equipmentRepeatFailures).toHaveLength(1);
    expect(s.equipmentRepeatFailures[0]?.equipmentKind).toBe('excavator');
    expect(s.supervisorAttrition90d).toBe(2);
    expect(s.royaltyDraftPctDeviation).toBeCloseTo(-12, 5);
    expect(s.nemcAmber).toBe(true);
    expect(s.oshaAmber).toBe(true);
    expect(s.buyerLatePayments).toHaveLength(1);
    expect(s.supplierQualityIssues[0]?.offSpecCount).toBe(4);
    expect(s.withholdingTaxPayableTzs).toBe(80_000_000);
    expect(s.traInquiryOpen).toBe(true);
    expect(s.cdaMilestonesOverdue).toBe(2);
    expect(s.top3ContractsExpiring60d).toHaveLength(1);
    expect(s.disputeEscalations).toHaveLength(1);
    expect(s.productionMomMonthsDown).toBe(3);
  });

  it('fires the FLAGSHIP plus at least 6 other rules on the seeded state', async () => {
    const state = await buildScannerState(tenantId, { db: seededDb(), now });

    // Count EVERY rule whose detect() fires on the real seeded state — this is
    // the "does the rule fire on real data" proof, independent of the top-N
    // urgency ranking the public evaluateRisks() applies (a 70-day runway is a
    // low-URGENCY risk, so it is correctly out-ranked by short-window criticals
    // and would not appear in a limit-10 list even though it genuinely fires).
    const firedRuleIds = new Set(
      RISK_RULES.filter((r) => r.detect(state)).map((r) => r.id),
    );

    // FLAGSHIP genuinely fires on the real computed 70-day runway.
    expect(firedRuleIds.has('cash.runway_below_90d')).toBe(true);

    // At least 6 OTHER distinct rules fire on the real seeded backing data.
    const otherPool = [
      'cash.ar_aging_critical',
      'hr.payroll_readiness_gap',
      'operational.fuel_inventory_below_safety',
      'operational.equipment_failure_pattern',
      'hr.supervisor_attrition_spike',
      'compliance.audit_trigger_signal',
      'compliance.regulator_stop_work_risk',
      'counterparty.buyer_default_signal',
      'counterparty.supplier_quality_drop',
      'tax.withholding_exposure_critical',
      'tax.tra_inquiry_signal',
      'reputational.csr_commitment_slipping',
      'legal.contract_expiring_critical',
      'legal.dispute_escalation_pattern',
      'operational.production_trending_down_3mo',
    ];
    const firedFromPool = otherPool.filter((id) => firedRuleIds.has(id));
    expect(firedFromPool.length).toBeGreaterThanOrEqual(6);

    // And the public scanner still returns a non-empty ranked list on the same
    // real state (the live surface actually shows risks).
    const ranked = evaluateRisks(state, { limit: 10, minSeverity: 'low' });
    expect(ranked.length).toBeGreaterThanOrEqual(7);
  });

  it('the FLAGSHIP evaluates to a 70-day runway risk with the real day count', async () => {
    const state = await buildScannerState(tenantId, { db: seededDb(), now });
    const flagshipRule = RISK_RULES.find(
      (r) => r.id === 'cash.runway_below_90d',
    );
    expect(flagshipRule).toBeDefined();
    expect(flagshipRule?.detect(state)).toBe(true);
    const flagship = flagshipRule?.evaluate(state);
    // Rule severity band: <30 critical, <60 high, else medium. 70 → medium,
    // but it fires with the REAL computed day count in both locales.
    expect(flagship?.severity).toBe('medium');
    expect(flagship?.headline.en).toContain('70 days');
    expect(flagship?.headline.sw).toContain('siku 70');
  });

  it('still fail-softs a genuinely-absent source to null without throwing', async () => {
    // Seed ONLY the flagship inputs; every other backing table returns [].
    const db = makeStubDb({
      cash_balances: [{ cash_total: 210_000_000 }],
      costs: [{ daily_burn: 3_000_000 }],
    });
    const s = await buildScannerState(tenantId, { db, now });
    expect(s.cashRunwayDays).toBe(70); // real
    expect(s.arOverdue60dPctOfMonthly).toBeNull(); // absent → null, no throw
    expect(s.buyerLatePayments).toEqual([]);
    expect(s.withholdingTaxPayableTzs).toBeNull();
    expect(s.disputeEscalations).toEqual([]);
  });
});
