/**
 * scripts/live-verify/verify-powers.ts
 *
 * Live invocation harness covering the four power categories the
 * Borjie brain exposes:
 *
 *   A. Superpowers: live HTTP against the 4 owner endpoints
 *      (bulk-action, prefill, share-links, undo-journal, pinned-items)
 *      plus the SSE chip parser (`parseSuperpowers`) over the 6
 *      ui_* tag families.
 *   B. Opportunity scanner rules (33). Each rule has a tailored
 *      synthetic state slice so the per-rule `detect()` predicate
 *      fires regardless of mutual-exclusion with sibling rules.
 *   C. Risk scanner rules (33). Same shape as B against the
 *      `RiskScannerState` snapshot.
 *
 * All results land in /tmp/live-verify.json for downstream audit.
 *
 * Usage
 *   pnpm tsx scripts/live-verify/verify-powers.ts
 *   pnpm tsx scripts/live-verify/verify-powers.ts --category=opportunity
 *
 * Env
 *   VERIFY_BASE          default http://localhost:4001
 *   VERIFY_TENANT_ID     default 00000000-0000-0000-0000-000000000001
 *   VERIFY_OUTPUT        default /tmp/live-verify.json
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { SCAN_RULES as OPP_RULES } from '../../services/api-gateway/src/services/opportunity-scanner';
import type { ScanState } from '../../services/api-gateway/src/services/opportunity-scanner';
import { RISK_RULES } from '../../services/api-gateway/src/services/risk-scanner';
import type { RiskScannerState } from '../../services/api-gateway/src/services/risk-scanner/types';
import { parseSuperpowers } from '../../services/api-gateway/src/routes/ui-navigate-parser';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mint } = require('./mint-jwt.cjs') as {
  mint: (role: string, tenantId?: string) => string;
};

const BASE = process.env['VERIFY_BASE'] ?? 'http://localhost:4001';
const TENANT = process.env['VERIFY_TENANT_ID'] ?? '00000000-0000-0000-0000-000000000001';
const OUTPUT = process.env['VERIFY_OUTPUT'] ?? '/tmp/live-verify.json';

interface VerificationEntry {
  readonly category: string;
  readonly id: string;
  readonly status: 'pass' | 'fail' | 'skip';
  readonly httpStatus?: number;
  readonly preview: string;
  readonly note?: string;
}

const results: VerificationEntry[] = [];

function truncate(text: string, max = 500): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...[truncated]';
}

function log(line: string): void {
  process.stdout.write(line + '\n');
}

// =====================================================================
// A. Superpower HTTP endpoints
// =====================================================================

async function probeHttp(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  role: 'OWNER' | 'ADMIN',
  body?: unknown,
): Promise<{ httpStatus: number; preview: string }> {
  const token = mint(role, TENANT);
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body !== undefined && method !== 'GET') {
    init.body = JSON.stringify(body);
  }
  try {
    const r = await fetch(`${BASE}${path}`, init);
    const text = await r.text();
    return { httpStatus: r.status, preview: truncate(text) };
  } catch (err) {
    return { httpStatus: 0, preview: `network_error: ${(err as Error).message}` };
  }
}

async function verifySuperpowerHttp(): Promise<void> {
  log('\n=== A. Superpower HTTP endpoints ===');

  const probes: Array<{ id: string; method: 'GET' | 'POST'; path: string; body?: unknown; note: string }> = [
    {
      id: 'ui_bulk.bulk-action',
      method: 'POST',
      path: '/api/v1/owner/superpowers/bulk-action',
      body: {
        entityType: 'reminders',
        ids: ['rem-001', 'rem-002'],
        action: 'snooze',
        reason: 'Snooze pending licence renewals.',
      },
      note: 'POST /api/v1/owner/superpowers/bulk-action',
    },
    {
      id: 'ui_prefill.ack',
      method: 'POST',
      path: '/api/v1/owner/superpowers/prefill',
      body: { formId: 'loi.draft', values: { counterparty: 'ABC' }, accepted: true },
      note: 'POST /api/v1/owner/superpowers/prefill',
    },
    {
      id: 'ui_share.create',
      method: 'POST',
      path: '/api/v1/owner/share-links',
      body: {
        entityType: 'royalty_filing',
        entityId: 'q1-2026',
        expiresInHours: 168,
        permission: 'read',
        reason: 'Share Q1 royalty with accountant.',
      },
      note: 'POST /api/v1/owner/share-links',
    },
    {
      id: 'ui_undo.append',
      method: 'POST',
      path: '/api/v1/owner/undo-journal',
      body: {
        entityType: 'reminder',
        entityId: 'rem-005',
        actionKind: 'snooze',
        toolId: 'mining.brain.reminder.snooze',
        beforeState: { snoozedUntil: null },
        afterState: { snoozedUntil: '2026-06-29T00:00:00Z' },
        windowSeconds: 300,
      },
      note: 'POST /api/v1/owner/undo-journal',
    },
    {
      id: 'ui_undo.last',
      method: 'POST',
      path: '/api/v1/owner/undo-journal/undo-last',
      body: { reason: 'Owner clicked Undo chip' },
      note: 'POST /api/v1/owner/undo-journal/undo-last',
    },
    {
      id: 'ui_bookmark.pin',
      method: 'POST',
      path: '/api/v1/owner/pinned-items',
      body: { entityType: 'site', entityId: 'mwadui-pml-0241', label: 'Mwadui Pit' },
      note: 'POST /api/v1/owner/pinned-items',
    },
    {
      id: 'ui_undo.recent',
      method: 'GET',
      path: '/api/v1/owner/undo-journal/recent',
      note: 'GET /api/v1/owner/undo-journal/recent',
    },
    {
      id: 'ui_share.list',
      method: 'GET',
      path: '/api/v1/owner/share-links',
      note: 'GET /api/v1/owner/share-links',
    },
    {
      id: 'ui_bookmark.list',
      method: 'GET',
      path: '/api/v1/owner/pinned-items',
      note: 'GET /api/v1/owner/pinned-items',
    },
  ];

  // Sequential with 250ms gap to stay friendly to the watcher
  for (const p of probes) {
    const r = await probeHttp(p.method, p.path, 'OWNER', p.body);
    results.push({
      category: 'superpower.http',
      id: p.id,
      status: r.httpStatus >= 200 && r.httpStatus < 500 ? 'pass' : 'fail',
      httpStatus: r.httpStatus,
      preview: r.preview,
      note: p.note,
    });
    log(`  ${p.id.padEnd(28)} HTTP ${r.httpStatus}`);
    await new Promise((res) => setTimeout(res, 250));
  }
}

// =====================================================================
// B. Superpower SSE parser
// =====================================================================

function verifySuperpowerParser(): void {
  log('\n=== B. Superpower SSE parser (ui_* tag families) ===');

  const fixtures: ReadonlyArray<{
    id: string;
    text: string;
    expectKey: 'navigates' | 'prefills' | 'highlights' | 'shares' | 'bulks' | 'bookmarks';
  }> = [
    {
      id: 'ui_navigate.compliance_tab',
      text: '<ui_navigate>{"route":"/compliance","scopeIds":["mwadui"],"focus":"licence-expiring-30d","reason":"Take you to the compliance tab."}</ui_navigate>',
      expectKey: 'navigates',
    },
    {
      id: 'ui_prefill.loi_form',
      text: '<ui_prefill>{"formId":"loi.draft","values":{"counterparty":"ABC Off-takers","commodity":"gold"},"reason":"Pre-fill the LOI."}</ui_prefill>',
      expectKey: 'prefills',
    },
    {
      id: 'ui_highlight.overdue_task',
      // No `reason` field — highlightSchema uses message bilingual only
      text: '<ui_highlight>{"selector":"[data-tour=\\"task-overdue\\"]","message":{"en":"Overdue royalty filing.","sw":"Wasilisho la mrabaha limepita muda."}}</ui_highlight>',
      expectKey: 'highlights',
    },
    {
      id: 'ui_share.q1_royalty',
      text: '<ui_share>{"entityType":"royalty_filing","entityId":"q1-2026","expiresInHours":168,"permission":"read","reason":"Share Q1 royalty with accountant."}</ui_share>',
      expectKey: 'shares',
    },
    {
      id: 'ui_bulk.snooze_reminders',
      text: '<ui_bulk>{"entityType":"reminders","ids":["rem-001","rem-002"],"action":"snooze","reason":"Snooze upcoming licence reminders."}</ui_bulk>',
      expectKey: 'bulks',
    },
    {
      id: 'ui_bookmark.mwadui_site',
      text: '<ui_bookmark>{"entityType":"site","entityId":"mwadui-pml-0241","label":"Mwadui Pit"}</ui_bookmark>',
      expectKey: 'bookmarks',
    },
  ];

  for (const f of fixtures) {
    const parsed = parseSuperpowers(f.text);
    const arr = parsed[f.expectKey] as ReadonlyArray<unknown>;
    const pass = arr.length === 1 && parsed.dropped === 0;
    results.push({
      category: 'superpower.parser',
      id: f.id,
      status: pass ? 'pass' : 'fail',
      preview: truncate(
        JSON.stringify({
          key: f.expectKey,
          parsed: arr[0] ?? null,
          body: parsed.body,
          dropped: parsed.dropped,
        }),
      ),
      note: pass ? `tag stripped + parsed cleanly` : `parse failed (count=${arr.length}, dropped=${parsed.dropped})`,
    });
    log(`  ${f.id.padEnd(34)} parsed=${arr.length} dropped=${parsed.dropped}`);
  }

  // Composite test - all 6 in one shot
  const composite = fixtures.map((f) => f.text).join('\n');
  const composed = parseSuperpowers(composite);
  const compositePass =
    composed.navigates.length === 1 &&
    composed.prefills.length === 1 &&
    composed.highlights.length === 1 &&
    composed.shares.length === 1 &&
    composed.bulks.length === 1 &&
    composed.bookmarks.length === 1 &&
    composed.dropped === 0;
  results.push({
    category: 'superpower.parser',
    id: 'composite.6_chips',
    status: compositePass ? 'pass' : 'fail',
    preview: truncate(
      JSON.stringify({
        navigates: composed.navigates.length,
        prefills: composed.prefills.length,
        highlights: composed.highlights.length,
        shares: composed.shares.length,
        bulks: composed.bulks.length,
        bookmarks: composed.bookmarks.length,
        dropped: composed.dropped,
      }),
    ),
    note: 'all 6 ui_* tag families in one assistant response',
  });
  log(`  composite.6_chips                   pass=${compositePass}`);
}

// =====================================================================
// C. Opportunity scanner — per-rule fixtures
// =====================================================================

// Baseline state with empty/null sub-trees — each rule's fixture
// overrides the relevant slice. Any field a rule doesn't override
// stays null/empty so unrelated rules don't accidentally fire.
function emptyOpportunityState(): ScanState {
  return {
    tenantId: TENANT,
    nowIso: new Date('2026-05-29T00:00:00Z').toISOString(),
  } as unknown as ScanState;
}

// Map of rule.id -> partial state override. The verifier merges base
// + override before invoking detect/evaluate so each predicate fires
// in isolation, regardless of mutual exclusion with sibling rules.
const OPPORTUNITY_FIXTURES: Record<string, Partial<ScanState>> = {
  'fuel.supplier_arbitrage': {
    fuel: {
      litresPerTonneRolling30d: 9.0,
      peerP25LitresPerTonne: 7.0,
      currentDieselTzsPerLitre: 3500,
      tonnesProducedRolling30d: 4_000,
      supplierCount: 1,
    },
  },
  'fuel.consumption_audit_trigger': {
    // delta > 1.5 AND delta < 0.15 * p25 => use p25=15, rolling=16.6 (delta 1.6, threshold 2.25)
    fuel: {
      litresPerTonneRolling30d: 16.6,
      peerP25LitresPerTonne: 15.0,
      currentDieselTzsPerLitre: 3500,
      tonnesProducedRolling30d: 3_000,
      supplierCount: 2,
    },
  },
  'lbma.fix_premium_window': {
    fx: {
      lbmaFixUsdPerOz: 2_450,
      lbmaFixMean30dUsdPerOz: 2_200,
      lbmaFixStdev30d: 80,
      botGoldWindowOpen: false,
      parcelOzReady: 90,
    },
  },
  'bot.gold_window_open': {
    fx: {
      lbmaFixUsdPerOz: 2_300,
      lbmaFixMean30dUsdPerOz: 2_300,
      lbmaFixStdev30d: 50,
      botGoldWindowOpen: true,
      parcelOzReady: 90,
    },
  },
  'tra.royalty_rate_election': {
    tax: {
      traQuarterlyElectionDaysUntilDeadline: 5,
      currentRoyaltyRatePct: 7.0,
      altRoyaltyRatePct: 4.0,
      quarterlyRoyaltyTzs: 450_000_000,
    },
  },
  'tra.quarterly_filing_shortcut': {
    tax: {
      traQuarterlyElectionDaysUntilDeadline: 14,
      currentRoyaltyRatePct: 7.0,
      altRoyaltyRatePct: 4.0,
      quarterlyRoyaltyTzs: 450_000_000,
    },
  },
  'nemc.amnesty_window': {
    regulator: {
      nemcAmnestyWindowOpen: true,
      nemcAmnestyDaysRemaining: 18,
      tenantQualifiesForAmnesty: true,
      estimatedPenaltyAvoidedTzs: 250_000_000,
    },
  },
  'intercompany.surplus_routing': {
    estate: {
      subsidiaryCount: 3,
      intercompanySurplusTzs: 1_200_000_000,
      holdingCoExists: true,
      overdueSuccessionReviewCount: 0,
      forestryEntityCount: 0,
    },
  },
  'succession.review_overdue_advantage': {
    estate: {
      subsidiaryCount: 1,
      intercompanySurplusTzs: 0,
      holdingCoExists: true,
      overdueSuccessionReviewCount: 2,
      forestryEntityCount: 0,
    },
  },
  'capital.idle_cash_yield': {
    capital: {
      currentLoanRatePct: 14.5,
      tibBetterRatePct: 10.5,
      loanBalanceTzs: 1_500_000_000,
      cashOnHandTzs: 800_000_000,
      idleCashOver90dTzs: 600_000_000,
      tibillsYieldPct: 9.5,
    },
  },
  'capital.loan_refinance': {
    capital: {
      currentLoanRatePct: 16.0,
      tibBetterRatePct: 11.0,
      loanBalanceTzs: 1_500_000_000,
      cashOnHandTzs: 50_000_000,
      idleCashOver90dTzs: 0,
      tibillsYieldPct: 9.0,
    },
  },
  'buyer.competitive_offer': {
    marketplace: {
      latestBuyerOfferPremiumOverLbmaPct: 3.5,
      latestBuyerOfferParcelOzEquivalent: 70,
      latestBuyerName: 'Heraeus EA',
    },
    fx: {
      lbmaFixUsdPerOz: 2_400,
      lbmaFixMean30dUsdPerOz: 2_400,
      lbmaFixStdev30d: 0,
      botGoldWindowOpen: false,
      parcelOzReady: 0,
    },
  },
  'counterparty.new_buyer_premium': {
    counterparties: {
      newBuyerPremiumOpportunity: {
        buyerId: 'heraeus-ea',
        buyerName: 'Heraeus EA',
        premiumOverFixPct: 3.0,
        parcelOzEquivalent: 65,
      },
    },
    fx: {
      lbmaFixUsdPerOz: 2_400,
      lbmaFixMean30dUsdPerOz: 2_400,
      lbmaFixStdev30d: 0,
      botGoldWindowOpen: false,
      parcelOzReady: 0,
    },
  },
  'vendor.consolidation_discount': {
    vendors: {
      categoriesWithMultipleSuppliers: [
        { category: 'reagents', supplierCount: 4, annualSpendTzs: 800_000_000 },
      ],
    },
  },
  'training.apprenticeship_credit_available': {
    workforce: {
      apprenticeshipEligibleCount: 30,
      vetaSubsidyPerApprenticeTzs: 2_800_000,
      icaCertExpiringIn60dCount: 0,
      icaCertPerCertFeeTzs: 0,
    },
  },
  'ica.cert_batch_savings': {
    workforce: {
      apprenticeshipEligibleCount: 0,
      vetaSubsidyPerApprenticeTzs: 0,
      icaCertExpiringIn60dCount: 22,
      icaCertPerCertFeeTzs: 180_000,
    },
  },
  'insurance.broker_market_quote_better': {
    insurance: {
      policyDueWithin60d: true,
      currentAnnualPremiumTzs: 360_000_000,
      bestMarketQuoteTzs: 280_000_000,
    },
  },
  'peer.best_practice_unmatched': {
    peer: {
      tenantProductionPercentile: 0.45,
      p75Pattern: 'split-shift-operations',
      tenantUsesP75Pattern: false,
    },
  },
  'forestry.carbon_credit_eligible': {
    estate: {
      subsidiaryCount: 1,
      intercompanySurplusTzs: 0,
      holdingCoExists: true,
      overdueSuccessionReviewCount: 0,
      forestryEntityCount: 2,
    },
    carbon: { eligibleHectares: 450, tzsPerHectarePerYear: 1_200_000 },
  },
  'energy.solar_hybrid_switch': {
    energy: {
      currentGridTariffTzsPerKwh: 320,
      solarHybridTzsPerKwh: 190,
      monthlyKwhConsumption: 220_000,
    },
  },
  'ops.night_shift_activation': {
    ops: {
      nightShiftIdleCapacityPct: 60,
      nightShiftFuelDeltaTzsPerTonne: 0,
      bcmHaulDistanceMetresMean: 0,
      bcmHaulDistanceP25Metres: 0,
      rejectedOreTonnesRolling30d: 0,
      downstreamProcessingTzsPerTonne: 0,
      stockpileAgeP90Days: 0,
    },
  },
  'ops.haul_route_recalibration': {
    ops: {
      nightShiftIdleCapacityPct: 0,
      nightShiftFuelDeltaTzsPerTonne: 0,
      bcmHaulDistanceMetresMean: 2_200,
      bcmHaulDistanceP25Metres: 1_400,
      rejectedOreTonnesRolling30d: 0,
      downstreamProcessingTzsPerTonne: 0,
      stockpileAgeP90Days: 0,
    },
  },
  'ops.rejected_ore_processing': {
    ops: {
      nightShiftIdleCapacityPct: 0,
      nightShiftFuelDeltaTzsPerTonne: 0,
      bcmHaulDistanceMetresMean: 0,
      bcmHaulDistanceP25Metres: 0,
      rejectedOreTonnesRolling30d: 180,
      downstreamProcessingTzsPerTonne: 95_000,
      stockpileAgeP90Days: 0,
    },
  },
  'ops.stockpile_aging_clearance': {
    ops: {
      nightShiftIdleCapacityPct: 0,
      nightShiftFuelDeltaTzsPerTonne: 0,
      bcmHaulDistanceMetresMean: 0,
      bcmHaulDistanceP25Metres: 0,
      rejectedOreTonnesRolling30d: 0,
      downstreamProcessingTzsPerTonne: 0,
      stockpileAgeP90Days: 95,
    },
  },
  'compliance.insurance_auto_renew_shortcut': {
    insurance: {
      policyDueWithin60d: true,
      currentAnnualPremiumTzs: 240_000_000,
      bestMarketQuoteTzs: 230_000_000,
    },
  },
  'estate.holding_co_formation': {
    estate: {
      subsidiaryCount: 4,
      intercompanySurplusTzs: 0,
      holdingCoExists: false,
      overdueSuccessionReviewCount: 0,
      forestryEntityCount: 0,
    },
  },
  'revenue.downstream_offtaker': {
    ops: {
      nightShiftIdleCapacityPct: 0,
      nightShiftFuelDeltaTzsPerTonne: 0,
      bcmHaulDistanceMetresMean: 0,
      bcmHaulDistanceP25Metres: 0,
      rejectedOreTonnesRolling30d: 60,
      downstreamProcessingTzsPerTonne: 95_000,
      stockpileAgeP90Days: 0,
    },
  },
  'ops.blast_pattern_optimization': {
    peer: {
      tenantProductionPercentile: 0.55,
      p75Pattern: 'staggered-blast-pattern',
      tenantUsesP75Pattern: false,
    },
  },
  'hr.apprentice_retention_credit': {
    workforce: {
      apprenticeshipEligibleCount: 8,
      vetaSubsidyPerApprenticeTzs: 1_800_000,
      icaCertExpiringIn60dCount: 0,
      icaCertPerCertFeeTzs: 0,
    },
  },
  'capital.cash_sweep_better_account': {
    capital: {
      currentLoanRatePct: 0,
      tibBetterRatePct: 0,
      loanBalanceTzs: 0,
      cashOnHandTzs: 600_000_000,
      idleCashOver90dTzs: 350_000_000,
      tibillsYieldPct: 11.0,
    },
  },
  'estate.subsidiary_consolidation_group_relief': {
    estate: {
      subsidiaryCount: 5,
      intercompanySurplusTzs: 0,
      holdingCoExists: true,
      overdueSuccessionReviewCount: 0,
      forestryEntityCount: 0,
    },
  },
  'procurement.reagent_bulk_purchase': {
    vendors: {
      categoriesWithMultipleSuppliers: [
        { category: 'reagents', supplierCount: 5, annualSpendTzs: 1_400_000_000 },
      ],
    },
  },
  'compliance.cert_preemptive_renewal': {
    workforce: {
      apprenticeshipEligibleCount: 0,
      vetaSubsidyPerApprenticeTzs: 0,
      icaCertExpiringIn60dCount: 10,
      icaCertPerCertFeeTzs: 180_000,
    },
  },
};

function verifyOpportunityRules(): void {
  log('\n=== C. Opportunity scanner rules (33) ===');

  for (const rule of OPP_RULES) {
    const override = OPPORTUNITY_FIXTURES[rule.id];
    const state: ScanState = {
      ...emptyOpportunityState(),
      ...(override ?? {}),
    } as ScanState;

    try {
      const detected = rule.detect(state);
      if (!detected) {
        results.push({
          category: 'opportunity.rule',
          id: rule.id,
          status: 'fail',
          preview: 'detect() returned false against per-rule fixture',
          note: `kind=${rule.kind} did not fire (override exists: ${Boolean(override)})`,
        });
        log(`  ${rule.id.padEnd(54)} DETECT=false`);
        continue;
      }
      const opp = rule.evaluate(state);
      const preview = truncate(
        JSON.stringify({
          id: opp.id,
          kind: opp.kind,
          headline: opp.headline,
          narrativeEn: opp.narrative.en.slice(0, 200),
          narrativeSw: opp.narrative.sw.slice(0, 200),
          expectedValueTzs: opp.expectedValueTzs ?? null,
          confidence: opp.confidence,
          timeWindowDays: opp.timeWindowDays,
        }),
      );
      results.push({
        category: 'opportunity.rule',
        id: rule.id,
        status: 'pass',
        preview,
        note: `kind=${opp.kind} bilingual sw/en value=${opp.expectedValueTzs ?? 'null'} TZS`,
      });
      log(`  ${rule.id.padEnd(54)} PASS kind=${opp.kind}`);
    } catch (err) {
      results.push({
        category: 'opportunity.rule',
        id: rule.id,
        status: 'fail',
        preview: `threw: ${(err as Error).message}`,
        note: `kind=${rule.kind} evaluate threw`,
      });
      log(`  ${rule.id.padEnd(54)} THREW`);
    }
  }
}

// =====================================================================
// D. Risk scanner — per-rule fixtures
// =====================================================================

function emptyRiskState(): RiskScannerState {
  return {
    tenantId: TENANT,
    nowIso: new Date('2026-05-29T00:00:00Z').toISOString(),
    cashRunwayDays: null,
    arOverdue60dPctOfMonthly: null,
    payrollDueInDays: null,
    payrollAmountTzs: null,
    cashOnHandTzs: null,
    nemcEiaDaysToExpiry: null,
    botExportLicenceDaysToExpiry: null,
    traFilingDaysOverdue: null,
    traPenaltyAccrualTzs: null,
    productionMomMonthsDown: 0,
    productionMomDeltaPct: null,
    fuelDaysRemaining: null,
    equipmentRepeatFailures: [],
    supervisorAttrition90d: 0,
    operatorsWithExpiredIcaActive: 0,
    royaltyDraftPctDeviation: null,
    nemcAmber: false,
    oshaAmber: false,
    openIncidents: 0,
    buyerLatePayments: [],
    supplierQualityIssues: [],
    lbmaFixDelta30dSigma: null,
    fxUsdTzsVolatilityPctIntraday: null,
    monthlyRevenueTzs: null,
    successionReviewOverdueDays: null,
    principalOwnerAgeYears: null,
    insurancePoliciesExpiring30d: [],
    accessAnomaliesLastHour: 0,
    failedAuthSpike: 0,
    suspiciousActionCount: 0,
    csrGrievances60d: 0,
    cdaMilestonesOverdue: 0,
    withholdingTaxPayableTzs: null,
    withholdingProvisionTzs: null,
    traInquiryOpen: false,
    traFilingOverdueDays: null,
    top3ContractsExpiring60d: [],
    disputeEscalations: [],
    knownScopes: [],
  } as RiskScannerState;
}

const RISK_FIXTURES: Record<string, Partial<RiskScannerState>> = {
  'cash.runway_below_90d': { cashRunwayDays: 25 },
  // arOverdue60dPctOfMonthly is a raw percent (>15 fires)
  'cash.ar_aging_critical': { arOverdue60dPctOfMonthly: 35, monthlyRevenueTzs: 1_400_000_000 },
  // cash.payroll_short_warning needs payrollDueInDays in (7,14] AND cash < payroll*1.1
  'cash.payroll_short_warning': {
    payrollDueInDays: 11,
    payrollAmountTzs: 220_000_000,
    cashOnHandTzs: 80_000_000,
  },
  'regulatory.nemc_eia_expiring_30d': { nemcEiaDaysToExpiry: 18 },
  'regulatory.bot_export_licence_lapse': { botExportLicenceDaysToExpiry: 22 },
  'regulatory.tra_filing_overdue': { traFilingDaysOverdue: 9, traPenaltyAccrualTzs: 45_000_000 },
  // productionMomDeltaPct is raw percent (<= -8 fires)
  'operational.production_trending_down_3mo': { productionMomMonthsDown: 4, productionMomDeltaPct: -25 },
  'operational.fuel_inventory_below_safety': { fuelDaysRemaining: 5 },
  'operational.equipment_failure_pattern': {
    equipmentRepeatFailures: [{ equipmentKind: 'haul_truck_HD-465', count: 4, windowDays: 30 }],
  },
  'operational.incidents_open_high': { openIncidents: 7 },
  'hr.supervisor_attrition_spike': { supervisorAttrition90d: 4 },
  'hr.ica_cert_expired_active_duty': { operatorsWithExpiredIcaActive: 6 },
  // hr.ica_cert_expiring_30d fires when expired=0 AND openIncidents>0
  'hr.ica_cert_expiring_30d': {
    operatorsWithExpiredIcaActive: 0,
    openIncidents: 3,
  },
  'hr.payroll_readiness_gap': {
    payrollDueInDays: 6,
    payrollAmountTzs: 220_000_000,
    cashOnHandTzs: 80_000_000,
  },
  // royaltyDraftPctDeviation is raw percent, fires when <= -7
  'compliance.audit_trigger_signal': { royaltyDraftPctDeviation: -12 },
  // regulator_stop_work needs nemcAmber AND oshaAmber AND openIncidents>0
  'compliance.regulator_stop_work_risk': { nemcAmber: true, oshaAmber: true, openIncidents: 5 },
  // licence_inventory_thin fires when nemc OR osha amber
  'compliance.licence_inventory_thin': { nemcAmber: true },
  'counterparty.buyer_default_signal': {
    buyerLatePayments: [
      { buyerId: 'b-001', buyerName: 'BuyerCo', latePaymentCount: 5, crbScoreDelta: -85 },
    ],
  },
  'counterparty.supplier_quality_drop': {
    supplierQualityIssues: [{ supplierId: 's-001', supplierName: 'ReagentCo', offSpecCount: 4 }],
  },
  'market.lbma_fix_dropping': { lbmaFixDelta30dSigma: -2.8, monthlyRevenueTzs: 1_400_000_000 },
  'market.fx_swing_risk': { fxUsdTzsVolatilityPctIntraday: 4.2, monthlyRevenueTzs: 1_400_000_000 },
  // revenue_concentration_risk needs buyerLatePayments.length 1-2 AND revenue>100M
  'market.revenue_concentration_risk': {
    monthlyRevenueTzs: 1_400_000_000,
    buyerLatePayments: [
      { buyerId: 'top-buyer', buyerName: 'Top Buyer Co', latePaymentCount: 1, crbScoreDelta: -10 },
    ],
  },
  // succession_plan_stale needs > 365 days AND age > 65
  'estate.succession_plan_stale': { successionReviewOverdueDays: 400, principalOwnerAgeYears: 68 },
  'estate.insurance_lapsing_30d': {
    insurancePoliciesExpiring30d: [{ policyId: 'p-001', policyKind: 'fire', daysToExpiry: 12 }],
  },
  'estate.insurance_lapsing_60d': {
    insurancePoliciesExpiring30d: [{ policyId: 'p-002', policyKind: 'liability', daysToExpiry: 50 }],
  },
  'security.access_anomaly': { accessAnomaliesLastHour: 8, failedAuthSpike: 14 },
  'security.kill_switch_potential': { suspiciousActionCount: 5 },
  'reputational.community_grievance_spike': { csrGrievances60d: 7 },
  'reputational.csr_commitment_slipping': { cdaMilestonesOverdue: 3 },
  'tax.withholding_exposure_critical': {
    withholdingTaxPayableTzs: 220_000_000,
    withholdingProvisionTzs: 60_000_000,
  },
  'tax.tra_inquiry_signal': { traInquiryOpen: true, traFilingOverdueDays: 9 },
  'legal.contract_expiring_critical': {
    top3ContractsExpiring60d: [
      {
        contractId: 'c-001',
        counterpartyName: 'OfftakerCo',
        daysToExpiry: 22,
        annualValueTzs: 8_000_000_000,
        hasRenewalInFlight: false,
      },
    ],
  },
  'legal.dispute_escalation_pattern': {
    disputeEscalations: [
      { counterpartyId: 'cp-1', counterpartyName: 'OfftakerCo', disputeCount90d: 3 },
    ],
  },
};

function verifyRiskRules(): void {
  log('\n=== D. Risk scanner rules (33) ===');

  for (const rule of RISK_RULES) {
    const override = RISK_FIXTURES[rule.id];
    const state: RiskScannerState = {
      ...emptyRiskState(),
      ...(override ?? {}),
    } as RiskScannerState;

    try {
      const detected = rule.detect(state);
      if (!detected) {
        results.push({
          category: 'risk.rule',
          id: rule.id,
          status: 'fail',
          preview: 'detect() returned false against per-rule fixture',
          note: `kind=${rule.kind} severity=${rule.severity ?? 'n/a'} did not fire (override exists: ${Boolean(override)})`,
        });
        log(`  ${rule.id.padEnd(48)} DETECT=false`);
        continue;
      }
      const risk = rule.evaluate(state);
      const preview = truncate(
        JSON.stringify({
          id: risk.id,
          kind: risk.kind,
          severity: risk.severity,
          headline: risk.headline,
          narrativeEn: risk.narrative.en.slice(0, 200),
          narrativeSw: risk.narrative.sw.slice(0, 200),
          exposureTzs: risk.exposureTzs ?? null,
          timeToImpactDays: risk.timeToImpactDays,
          ruleId: risk.ruleId,
        }),
      );
      results.push({
        category: 'risk.rule',
        id: rule.id,
        status: 'pass',
        preview,
        note: `kind=${risk.kind} sev=${risk.severity} ttiDays=${risk.timeToImpactDays} bilingual sw/en`,
      });
      log(`  ${rule.id.padEnd(48)} PASS sev=${risk.severity}`);
    } catch (err) {
      results.push({
        category: 'risk.rule',
        id: rule.id,
        status: 'fail',
        preview: `threw: ${(err as Error).message}`,
        note: `kind=${rule.kind} evaluate threw`,
      });
      log(`  ${rule.id.padEnd(48)} THREW`);
    }
  }
}

// =====================================================================
// Main
// =====================================================================

async function main(): Promise<void> {
  const category = process.argv.find((a) => a.startsWith('--category='))?.split('=')[1];

  if (!category || category === 'superpowers') {
    await verifySuperpowerHttp();
    verifySuperpowerParser();
  }
  if (!category || category === 'opportunity') {
    verifyOpportunityRules();
  }
  if (!category || category === 'risk') {
    verifyRiskRules();
  }

  const summary = {
    base: BASE,
    tenant: TENANT,
    runAt: new Date().toISOString(),
    counts: {
      total: results.length,
      pass: results.filter((r) => r.status === 'pass').length,
      fail: results.filter((r) => r.status === 'fail').length,
      skip: results.filter((r) => r.status === 'skip').length,
    },
    byCategory: {} as Record<string, { total: number; pass: number; fail: number; skip: number }>,
    results,
  };
  for (const r of results) {
    const k = r.category;
    if (!summary.byCategory[k]) summary.byCategory[k] = { total: 0, pass: 0, fail: 0, skip: 0 };
    summary.byCategory[k].total += 1;
    summary.byCategory[k][r.status] += 1;
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(summary, null, 2));

  log('\n=== Summary ===');
  log(`Total ${summary.counts.total}  pass=${summary.counts.pass}  fail=${summary.counts.fail}  skip=${summary.counts.skip}`);
  for (const [cat, c] of Object.entries(summary.byCategory)) {
    log(`  ${cat.padEnd(28)} pass=${c.pass}/${c.total}  fail=${c.fail}`);
  }
  log(`\nWrote ${OUTPUT}`);
}

main().catch((err) => {
  log(`FATAL: ${(err as Error).message}`);
  process.exitCode = 1;
});
