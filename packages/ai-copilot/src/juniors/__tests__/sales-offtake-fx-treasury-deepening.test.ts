/**
 * Tests for the deepened commercial-book juniors:
 *   - Sales / Off-take: deterministic NET-revenue settlement engine
 *     (quality specs, payabilities, TC/RC, deleterious penalties).
 *   - FX / Treasury: deterministic covenant engine (DSCR/LLCR/PLCR,
 *     reserve-tail, DSRA) + board-bounded hedging stance.
 *
 * The math modules are tested as pure functions; the agents are tested
 * for the junior contract (evidence gate, deterministic-block authority,
 * error propagation) with a mocked Claude client.
 */

import { describe, it, expect } from 'vitest';
import type { ClaudeClient } from '../_shared.js';
import {
  computeOfftakeSettlement,
  realisationBandFlag,
  type OfftakeTerms,
} from '../offtake-settlement.js';
import {
  assessCovenants,
  recommendHedgeStance,
  DEFAULT_COVENANT_THRESHOLDS,
  type CovenantInputs,
} from '../treasury-covenants.js';
import { createSalesOfftakeAgent } from '../sales-offtake-agent.js';
import { createFxTreasuryAgent } from '../fx-treasury-agent.js';

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

// ─────────────────────────────────────────────────────────────────────
// Off-take settlement (pure deterministic math)
// ─────────────────────────────────────────────────────────────────────

describe('computeOfftakeSettlement', () => {
  it('computes NET (not gross): gross − TC − RC − penalties − freight', () => {
    // 1000 dmt of 28 % Cu concentrate, 96.5 % payable, 1-unit deduction.
    const terms: OfftakeTerms = {
      dmt: 1000,
      tc_per_dmt: 80,
      rc_per_payable_unit: { Cu: 200 },
      metals: [
        {
          metal: 'Cu',
          grade_fraction: 0.28,
          payable_fraction: 0.965,
          min_deduction_unit: 0.01, // 1 %-unit
          reference_price_per_unit: 9000, // per tonne of contained Cu
          pricing_basis: 'mass_fraction',
        },
      ],
      penalties: [],
    };
    const s = computeOfftakeSettlement(terms);
    // contained Cu = 280 t; payable = min(280-10, 280*0.965=270.2) = 270 t
    expect(s.metal_lines[0]?.contained_units).toBe(280);
    expect(s.metal_lines[0]?.payable_units).toBe(270);
    // gross = 270 * 9000 = 2,430,000
    expect(s.gross_value).toBe(2_430_000);
    // tc = 80 * 1000 = 80,000 ; rc = 270 * 200 = 54,000
    expect(s.tc_charge).toBe(80_000);
    expect(s.rc_charge_total).toBe(54_000);
    // net = 2,430,000 - 80,000 - 54,000 = 2,296,000
    expect(s.net_payable_value).toBe(2_296_000);
    // realisation = net/gross ~ 94.5 % → in the 85-96.5 band
    expect(s.payable_pct_of_gross).toBeGreaterThan(85);
    expect(s.payable_pct_of_gross).toBeLessThan(96.5);
    expect(realisationBandFlag(s.payable_pct_of_gross)).toBe('in_band');
  });

  it('applies deleterious penalties only above threshold and flags rejection', () => {
    const terms: OfftakeTerms = {
      dmt: 100,
      tc_per_dmt: 0,
      rc_per_payable_unit: {},
      metals: [
        {
          metal: 'Cu',
          grade_fraction: 0.3,
          payable_fraction: 1,
          reference_price_per_unit: 10_000,
          pricing_basis: 'mass_fraction',
        },
      ],
      penalties: [
        { element: 'As', assay_ppm: 3000, threshold_ppm: 2000, charge_per_ppm_over: 0.5, reject_above_ppm: 5000 },
        { element: 'Hg', assay_ppm: 50, threshold_ppm: 100, charge_per_ppm_over: 2 }, // below threshold → no penalty
      ],
    };
    const s = computeOfftakeSettlement(terms);
    // As: (3000-2000) * 0.5 * 100 dmt = 50,000 ; Hg: 0
    expect(s.penalty_charge_total).toBe(50_000);
    expect(s.cargo_rejectable).toBe(false);
  });

  it('flags cargo rejection when a deleterious assay exceeds the ceiling', () => {
    const terms: OfftakeTerms = {
      dmt: 10,
      tc_per_dmt: 0,
      rc_per_payable_unit: {},
      metals: [
        { metal: 'Cu', grade_fraction: 0.3, payable_fraction: 1, reference_price_per_unit: 10_000, pricing_basis: 'mass_fraction' },
      ],
      penalties: [
        { element: 'As', assay_ppm: 9000, threshold_ppm: 2000, charge_per_ppm_over: 0.5, reject_above_ppm: 5000 },
      ],
    };
    const s = computeOfftakeSettlement(terms);
    expect(s.cargo_rejectable).toBe(true);
  });

  it('prices precious metals on a per-gram basis', () => {
    const terms: OfftakeTerms = {
      dmt: 50,
      tc_per_dmt: 0,
      rc_per_payable_unit: { Au: 0 },
      metals: [
        {
          metal: 'Au',
          grade_g_per_t: 40, // 40 g/t Au in concentrate
          payable_fraction: 0.98,
          reference_price_per_unit: 200, // per gram
          pricing_basis: 'per_gram',
        },
      ],
      penalties: [],
    };
    const s = computeOfftakeSettlement(terms);
    // contained = 50 * 40 = 2000 g ; payable = 2000 * 0.98 = 1960 g
    expect(s.metal_lines[0]?.contained_units).toBe(2000);
    expect(s.metal_lines[0]?.payable_units).toBe(1960);
    expect(s.net_payable_value).toBe(1960 * 200);
  });

  it('realisationBandFlag classifies below / in / above band', () => {
    expect(realisationBandFlag(80)).toBe('below_band');
    expect(realisationBandFlag(90)).toBe('in_band');
    expect(realisationBandFlag(99)).toBe('above_band');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Treasury covenants (pure deterministic math)
// ─────────────────────────────────────────────────────────────────────

const HEALTHY: CovenantInputs = {
  cfads_period: 300,
  debt_service_period: 150, // DSCR = 2.0
  npv_cfads_loan_life: 2000,
  npv_cfads_project_life: 3000,
  debt_outstanding: 1000, // LLCR=2.0, PLCR=3.0
  reserves_at_final_repayment: 40,
  total_reserves: 100, // reserve-tail 40 %
  dsra_balance: 75,
  dsra_required_months: 6,
  period_months: 12, // required = 150 * 0.5 = 75 → exactly covered
  equator_principles_cleared: true,
};

describe('assessCovenants', () => {
  it('passes every covenant for a healthy facility', () => {
    const a = assessCovenants(HEALTHY);
    expect(a.dscr.value).toBe(2);
    expect(a.dscr.status).toBe('pass');
    expect(a.llcr.status).toBe('pass');
    expect(a.plcr.status).toBe('pass');
    expect(a.reserve_tail.value).toBe(40);
    expect(a.reserve_tail.status).toBe('pass');
    expect(a.dsra.status).toBe('pass');
    expect(a.any_breach).toBe(false);
    expect(a.breaches).toEqual([]);
    expect(a.es_gate_cleared).toBe(true);
  });

  it('flags DSCR breach below the 1.5x threshold', () => {
    const a = assessCovenants({ ...HEALTHY, cfads_period: 150 }); // DSCR=1.0
    expect(a.dscr.value).toBe(1);
    expect(a.dscr.status).toBe('breach');
    expect(a.any_breach).toBe(true);
    expect(a.breaches).toContain('dscr');
  });

  it('flags reserve-tail breach below 30 %', () => {
    const a = assessCovenants({ ...HEALTHY, reserves_at_final_repayment: 20 }); // 20 %
    expect(a.reserve_tail.status).toBe('breach');
    expect(a.breaches).toContain('reserve_tail');
  });

  it('flags DSRA shortfall and computes the required balance', () => {
    const a = assessCovenants({ ...HEALTHY, dsra_balance: 50 }); // required 75 → shortfall 25
    expect(a.dsra.required).toBe(75);
    expect(a.dsra.shortfall).toBe(25);
    expect(a.dsra.status).toBe('breach');
    expect(a.breaches).toContain('dsra');
  });

  it('honors custom thresholds', () => {
    const a = assessCovenants(HEALTHY, { ...DEFAULT_COVENANT_THRESHOLDS, dscr_min: 2.5 });
    expect(a.dscr.status).toBe('breach'); // 2.0 < 2.5
  });
});

describe('recommendHedgeStance', () => {
  it('targets committed/exposed ratio capped by the board policy', () => {
    const h = recommendHedgeStance({
      committed_outflow: 600,
      exposed_revenue: 1000, // natural target 0.6
      already_hedged_notional: 0,
      board_max_hedge_ratio: 0.5, // cap below natural target
      current_dscr: 2.0,
    });
    expect(h.target_hedge_ratio).toBe(0.5); // capped
    expect(h.board_cap_respected).toBe(true);
    expect(h.stance).toBe('increase_cover');
    expect(h.recommended_incremental_notional).toBe(500); // 0.5 * 1000 - 0
    expect(h.instruments_suggested).toContain('forwards');
  });

  it('leans to downside-only instruments when DSCR is thin', () => {
    const h = recommendHedgeStance({
      committed_outflow: 400,
      exposed_revenue: 1000,
      already_hedged_notional: 0,
      board_max_hedge_ratio: 0.8,
      current_dscr: 1.2, // below 1.5 floor
    });
    expect(h.instruments_suggested).toContain('protective_puts');
    expect(h.instruments_suggested).toContain('zero_cost_collar');
  });

  it('holds when already at target', () => {
    const h = recommendHedgeStance({
      committed_outflow: 500,
      exposed_revenue: 1000, // target 0.5
      already_hedged_notional: 500, // current 0.5
      board_max_hedge_ratio: 0.5,
      current_dscr: 2.0,
    });
    expect(h.stance).toBe('hold');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Sales / Off-take agent — junior contract + deterministic authority
// ─────────────────────────────────────────────────────────────────────

const SALES_VALID = {
  parcel_id: 'p1',
  buyer_comparison: [{ buyer_id: 'b1', net_price_tzs: 100, cash_conversion_days: 1, deductions_tzs: 0 }],
  recommended_buyer_id: 'b1',
  recommendation_reason: 'best NET realisation',
  mtc_preflight_required: true,
  mtc_documents_needed: ['MTC-001'],
  offtake_settlement: null,
  confidence: 0.8,
  rationale: 'NET beats the alternatives',
  evidence_ids: ['assay_cert_1'],
  citations: [],
};

const SALES_INPUT_WITH_TERMS = {
  tenantId: 't1',
  parcel: { parcel_id: 'p1', source_pml: 'PML-1', mineral: 'Cu', mass_g_or_t: 1000 },
  buyers: [{ buyer_id: 'b1', name: 'Smelter', route: 'CN_KR_EU' as const, payment_terms_days: 30 }],
  current_bot_rate_tzs_per_usd: 2600,
  offtake_terms: {
    dmt: 1000,
    tc_per_dmt: 80,
    rc_per_payable_unit: { Cu: 200 },
    metals: [{
      metal: 'Cu', grade_fraction: 0.28, payable_fraction: 0.965,
      min_deduction_unit: 0.01, reference_price_per_unit: 9000, pricing_basis: 'mass_fraction' as const,
    }],
    penalties: [],
    currency_code: 'USD',
  },
};

describe('sales-offtake-agent (deepened)', () => {
  it('computes the deterministic NET settlement and overrides any LLM echo', async () => {
    // LLM tries to claim a wrong (inflated) settlement; agent must overwrite it.
    const lying = {
      ...SALES_VALID,
      offtake_settlement: {
        currency_code: 'USD', gross_value: 9_999, tc_charge: 0, rc_charge_total: 0,
        penalty_charge_total: 0, freight_insurance_total: 0, net_payable_value: 9_999,
        payable_pct_of_gross: 100, realisation_band: 'above_band', cargo_rejectable: false,
        metal_lines: [], penalty_lines: [],
      },
    };
    const agent = createSalesOfftakeAgent({ claude: claudeOf(lying) });
    const out = await agent.processInput(SALES_INPUT_WITH_TERMS);
    expect(out.offtake_settlement).not.toBeNull();
    // Authoritative deterministic value, NOT the LLM's 9999.
    expect(out.offtake_settlement?.net_payable_value).toBe(2_296_000);
    expect(out.offtake_settlement?.currency_code).toBe('USD');
    expect(out.offtake_settlement?.realisation_band).toBe('in_band');
  });

  it('leaves settlement null when no off-take terms are supplied', async () => {
    const agent = createSalesOfftakeAgent({ claude: claudeOf(SALES_VALID) });
    const out = await agent.processInput({
      tenantId: 't1',
      parcel: { parcel_id: 'p1', source_pml: 'PML-1', mineral: 'Au', mass_g_or_t: 100 },
      buyers: [{ buyer_id: 'b1', name: 'BoT', route: 'BoT' as const, payment_terms_days: 1 }],
      current_bot_rate_tzs_per_usd: 2600,
    });
    expect(out.offtake_settlement).toBeNull();
    expect(out.recommended_buyer_id).toBe('b1');
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createSalesOfftakeAgent({ claude: claudeOf({ ...SALES_VALID, evidence_ids: [] }) });
    await expect(agent.processInput(SALES_INPUT_WITH_TERMS)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('offtake_feed_down'); } };
    const agent = createSalesOfftakeAgent({ claude });
    await expect(agent.processInput(SALES_INPUT_WITH_TERMS)).rejects.toThrow(/offtake_feed_down/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// FX / Treasury agent — junior contract + deterministic authority
// ─────────────────────────────────────────────────────────────────────

const FX_VALID = {
  mode: 'covenants',
  recommendation: 'hold_pending_evidence',
  usd_contracts_to_convert: [],
  cliff_date: '2026-03-27',
  days_to_cliff: 0,
  covenant_assessment: null,
  hedging_recommendation: null,
  confidence: 0.8,
  rationale: 'covenant review',
  evidence_ids: ['facility_agreement_cl_12'],
  citations: [],
};

const FX_INPUT_COVENANTS = {
  tenantId: 't1',
  mode: 'covenants' as const,
  current_bot_rate_tzs_per_usd: 2600,
  covenant_inputs: {
    cfads_period: 150,
    debt_service_period: 150, // DSCR 1.0 → breach
    npv_cfads_loan_life: 2000,
    npv_cfads_project_life: 3000,
    debt_outstanding: 1000,
    reserves_at_final_repayment: 40,
    total_reserves: 100,
    dsra_balance: 75,
    dsra_required_months: 6,
    period_months: 12,
    equator_principles_cleared: true,
    currency_code: 'USD',
  },
  hedging_inputs: {
    committed_outflow: 600,
    exposed_revenue: 1000,
    already_hedged_notional: 0,
    board_max_hedge_ratio: 0.5,
    current_dscr: 1.0,
  },
};

describe('fx-treasury-agent (deepened)', () => {
  it('computes the deterministic covenant assessment and overrides LLM echo', async () => {
    // LLM falsely claims everything passes; agent must overwrite with truth.
    const lying = {
      ...FX_VALID,
      covenant_assessment: {
        currency_code: 'USD',
        dscr: { value: 9, threshold: 1.5, status: 'pass', headroom: 7.5 },
        llcr: { value: 9, threshold: 1.7, status: 'pass', headroom: 7.3 },
        plcr: { value: 9, threshold: 2, status: 'pass', headroom: 7 },
        reserve_tail: { value: 99, threshold: 30, status: 'pass', headroom: 69 },
        dsra: { balance: 75, required: 75, shortfall: 0, status: 'pass' },
        es_gate_cleared: true, any_breach: false, breaches: [],
      },
    };
    const agent = createFxTreasuryAgent({ claude: claudeOf(lying) });
    const out = await agent.processInput(FX_INPUT_COVENANTS);
    expect(out.covenant_assessment?.dscr.value).toBe(1); // deterministic truth
    expect(out.covenant_assessment?.dscr.status).toBe('breach');
    expect(out.covenant_assessment?.any_breach).toBe(true);
    expect(out.covenant_assessment?.breaches).toContain('dscr');
    expect(out.covenant_assessment?.currency_code).toBe('USD');
  });

  it('computes the deterministic board-bounded hedge stance', async () => {
    const agent = createFxTreasuryAgent({ claude: claudeOf(FX_VALID) });
    const out = await agent.processInput(FX_INPUT_COVENANTS);
    expect(out.hedging_recommendation?.target_hedge_ratio).toBe(0.5); // capped by board
    expect(out.hedging_recommendation?.board_cap_respected).toBe(true);
    expect(out.hedging_recommendation?.instruments_suggested).toContain('protective_puts');
  });

  it('leaves covenant/hedging null in non-covenant modes', async () => {
    const agent = createFxTreasuryAgent({ claude: claudeOf({ ...FX_VALID, mode: 'rate_check' }) });
    const out = await agent.processInput({ tenantId: 't1', mode: 'rate_check', current_bot_rate_tzs_per_usd: 2600 });
    expect(out.covenant_assessment).toBeNull();
    expect(out.hedging_recommendation).toBeNull();
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createFxTreasuryAgent({ claude: claudeOf({ ...FX_VALID, evidence_ids: [] }) });
    await expect(agent.processInput(FX_INPUT_COVENANTS)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('treasury_feed_down'); } };
    const agent = createFxTreasuryAgent({ claude });
    await expect(agent.processInput(FX_INPUT_COVENANTS)).rejects.toThrow(/treasury_feed_down/);
  });
});
