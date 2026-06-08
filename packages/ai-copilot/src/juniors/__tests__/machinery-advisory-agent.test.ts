import { describe, it, expect } from 'vitest';
import {
  createMachineryAdvisoryAgent,
  MachineryAdvisoryInputSchema,
} from '../machinery-advisory-agent.js';
import type { ClaudeClient, DrizzleLikeClient } from '../_shared.js';
import {
  computeReliabilityKpis,
  selectMaintenanceStrategy,
  matchLoaderToTruck,
  sizeFleet,
  sizeGenset,
  leaseVsBuy,
  rankSuppliersByTco,
  failureModesFor,
  MMA_EVIDENCE,
} from '../machinery-advisory-knowledge.js';

// ─────────────────────────────────────────────────────────────────────
// Test doubles
// ─────────────────────────────────────────────────────────────────────

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

/** Captures the LLM userPrompt so we can assert deterministic facts are injected. */
function capturingClaude(payload: unknown): { client: ClaudeClient; lastUserPrompt: () => string } {
  let last = '';
  return {
    client: {
      async complete({ userPrompt }) {
        last = userPrompt;
        return { content: JSON.stringify(payload) };
      },
    },
    lastUserPrompt: () => last,
  };
}

const LLM_BASE = {
  asset_id: 'EX-001',
  mode: 'diagnosis',
  currency: 'TZS',
  summary: 'engineer narrative',
  recommendations: ['inspect cooling system'],
  computed: {},
  confidence: 0.78,
  rationale: 'symptoms point to cooling',
  evidence_ids: ['llm_extra'],
  citations: [],
};

const DIAGNOSIS_INPUT = {
  mode: 'diagnosis' as const,
  tenantId: 't1',
  asset_id: 'EX-001',
  asset_class: 'haul_truck' as const,
  currency: 'TZS',
  symptoms: ['rising coolant temp'],
  reliability: { operating_hours: 1000, repair_downtime_hours: 20, failures: 4 },
};

// ─────────────────────────────────────────────────────────────────────
// Junior contract — happy path + Auditor base + error propagation
// ─────────────────────────────────────────────────────────────────────

describe('machinery-advisory-agent: contract', () => {
  it('diagnosis happy path merges deterministic + LLM evidence_ids', async () => {
    const agent = createMachineryAdvisoryAgent({ claude: claudeOf(LLM_BASE) });
    const out = await agent.processInput(DIAGNOSIS_INPUT);
    expect(out.asset_id).toBe('EX-001');
    expect(out.mode).toBe('diagnosis');
    expect(out.evidence_ids).toContain('llm_extra');
    expect(out.evidence_ids).toContain(MMA_EVIDENCE.failureCrib);
    expect(out.evidence_ids).toContain(MMA_EVIDENCE.reliabilityKpis);
    // deterministic failure-mode crib + reliability KPIs surfaced verbatim
    expect(out.computed.candidate_failure_modes).toBeTruthy();
    expect(out.computed.reliability_kpis).toBeTruthy();
  });

  it('injects COMPUTED_FACTS (with evidence ids) into the brain port prompt', async () => {
    const { client, lastUserPrompt } = capturingClaude(LLM_BASE);
    const agent = createMachineryAdvisoryAgent({ claude: client });
    await agent.processInput(DIAGNOSIS_INPUT);
    expect(lastUserPrompt()).toContain('COMPUTED_FACTS');
    expect(lastUserPrompt()).toContain(MMA_EVIDENCE.failureCrib);
    expect(lastUserPrompt()).toContain('rising coolant temp');
  });

  it('forces asset_id/mode/currency from the request, not the LLM echo', async () => {
    const agent = createMachineryAdvisoryAgent({
      claude: claudeOf({ ...LLM_BASE, asset_id: 'WRONG', mode: 'lease_vs_buy', currency: 'USD' }),
    });
    const out = await agent.processInput(DIAGNOSIS_INPUT);
    expect(out.asset_id).toBe('EX-001');
    expect(out.mode).toBe('diagnosis');
    expect(out.currency).toBe('TZS');
  });

  it('rejects when LLM evidence_ids is empty (Auditor base)', async () => {
    const agent = createMachineryAdvisoryAgent({ claude: claudeOf({ ...LLM_BASE, evidence_ids: [] }) });
    await expect(agent.processInput(DIAGNOSIS_INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('oem_lookup_fail'); } };
    const agent = createMachineryAdvisoryAgent({ claude });
    await expect(agent.processInput(DIAGNOSIS_INPUT)).rejects.toThrow(/oem_lookup_fail/);
  });

  it('rejects unknown mode at the schema boundary', () => {
    const r = MachineryAdvisoryInputSchema.safeParse({ ...DIAGNOSIS_INPUT, mode: 'nonsense' });
    expect(r.success).toBe(false);
  });

  it('skips db write gracefully when insert throws', async () => {
    const db: DrizzleLikeClient = {
      execute: async () => undefined,
      insert: () => {
        throw new Error('db down');
      },
    };
    const agent = createMachineryAdvisoryAgent({ claude: claudeOf(LLM_BASE), db });
    // Whether the schema barrel resolves or not, a failing insert must be
    // swallowed (logger.warn) and never propagate to the caller.
    const out = await agent.processInput(DIAGNOSIS_INPUT);
    expect(out.asset_id).toBe('EX-001');
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────
// Per-mode deterministic facts flow through the engine
// ─────────────────────────────────────────────────────────────────────

describe('machinery-advisory-agent: modes', () => {
  it('maintenance_strategy returns RCM verdict + KPIs', async () => {
    const out = await createMachineryAdvisoryAgent({
      claude: claudeOf({ ...LLM_BASE, mode: 'maintenance_strategy' }),
    }).processInput({
      mode: 'maintenance_strategy',
      tenantId: 't1',
      asset_id: 'HT-9',
      asset_class: 'haul_truck',
      currency: 'TZS',
      criticality: 'A',
      degradation_measurable: true,
      high_value_or_mobile: true,
      reliability: { operating_hours: 2000, repair_downtime_hours: 40, failures: 5 },
    });
    expect((out.computed.strategy as { strategy: string }).strategy).toBe('predictive');
    expect(out.evidence_ids).toContain(MMA_EVIDENCE.strategySelector);
  });

  it('selection_sizing returns loader/truck + fleet + genset blocks', async () => {
    const out = await createMachineryAdvisoryAgent({
      claude: claudeOf({ ...LLM_BASE, mode: 'selection_sizing' }),
    }).processInput({
      mode: 'selection_sizing',
      tenantId: 't1',
      asset_id: 'FLEET',
      asset_class: 'genset',
      currency: 'TZS',
      loader_truck: {
        loader_dipper_yd3: 5,
        bucket_payload_t: 8,
        target_truck_payload_t: 90,
        observed_fill_factor: 0.88,
      },
      genset: { expected_load_kw: 300, rating_kw: 1000, duty: 'prime' },
    });
    expect(out.computed.loader_truck_match).toBeTruthy();
    expect(out.computed.genset_sizing).toBeTruthy();
    expect(out.evidence_ids).toContain(MMA_EVIDENCE.loaderTruckMatch);
  });

  it('lease_vs_buy returns a verdict and the AISC note', async () => {
    const out = await createMachineryAdvisoryAgent({
      claude: claudeOf({ ...LLM_BASE, mode: 'lease_vs_buy' }),
    }).processInput({
      mode: 'lease_vs_buy',
      tenantId: 't1',
      asset_id: 'HT-1',
      asset_class: 'haul_truck',
      currency: 'TZS',
      finance: {
        purchase_price: 2_000_000,
        economic_life_years: 8,
        residual_value: 200_000,
        annual_owning_fixed_cost: 100_000,
        operating_cost_per_hour: 80,
        rental_rate_per_hour: 250,
        expected_hours_per_year: 3000,
      },
    });
    expect((out.computed.lease_vs_buy as { verdict: string }).verdict).toMatch(/buy_finance|lease|breakeven/);
    expect(out.evidence_ids).toContain(MMA_EVIDENCE.aiscTreatment);
  });

  it('procurement_tco ranks suppliers and never sticker-price', async () => {
    const out = await createMachineryAdvisoryAgent({
      claude: claudeOf({ ...LLM_BASE, mode: 'procurement_tco' }),
    }).processInput({
      mode: 'procurement_tco',
      tenantId: 't1',
      asset_id: 'BUY',
      asset_class: 'excavator',
      currency: 'TZS',
      bids: [
        {
          supplier_id: 'cheap_no_dealer',
          sticker_price: 1_000_000,
          est_lifetime_fuel_cost: 900_000,
          est_lifetime_parts_cost: 900_000,
          parts_lead_time_days: 120,
          warranty_months: 6,
          in_country_dealer: false,
          local_content_pct: 5,
        },
        {
          supplier_id: 'pricey_local_dealer',
          sticker_price: 1_300_000,
          est_lifetime_fuel_cost: 500_000,
          est_lifetime_parts_cost: 400_000,
          parts_lead_time_days: 10,
          warranty_months: 24,
          in_country_dealer: true,
          local_content_pct: 60,
        },
      ],
    });
    const ranking = out.computed.procurement_ranking as { winner_id: string };
    // higher sticker but far lower TCO + dealer + warranty wins
    expect(ranking.winner_id).toBe('pricey_local_dealer');
    expect(out.evidence_ids).toContain(MMA_EVIDENCE.tcoNotSticker);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Pure knowledge-pack units (deterministic, grounded in the dossier)
// ─────────────────────────────────────────────────────────────────────

describe('machinery-advisory-knowledge: pure units', () => {
  it('MTBF/MTTR/availability per ISO 14224 (§2.4)', () => {
    const k = computeReliabilityKpis({ operating_hours: 1000, repair_downtime_hours: 20, failures: 4 });
    expect(k.mtbf_hours).toBe(250); // 1000/4
    expect(k.mttr_hours).toBe(5); // 20/4
    expect(k.availability).toBeCloseTo(250 / 255, 4);
  });

  it('zero failures => full availability', () => {
    const k = computeReliabilityKpis({ operating_hours: 500, repair_downtime_hours: 0, failures: 0 });
    expect(k.availability).toBe(1);
    expect(k.mtbf_hours).toBe(500);
  });

  it('RCM selector: class-C cheap => run_to_failure; class-A measurable mobile => predictive', () => {
    expect(
      selectMaintenanceStrategy({ criticality: 'C', degradation_measurable: false, high_value_or_mobile: false })
        .strategy,
    ).toBe('run_to_failure');
    expect(
      selectMaintenanceStrategy({ criticality: 'A', degradation_measurable: true, high_value_or_mobile: true })
        .strategy,
    ).toBe('predictive');
    expect(
      selectMaintenanceStrategy({ criticality: 'B', degradation_measurable: true, high_value_or_mobile: false })
        .strategy,
    ).toBe('condition_based');
    expect(
      selectMaintenanceStrategy({ criticality: 'B', degradation_measurable: false, high_value_or_mobile: false })
        .strategy,
    ).toBe('preventive');
  });

  it('loader-truck 9:1 match (§3.1): t = 9.0 * S^1.1 and fill-factor band', () => {
    const m = matchLoaderToTruck({
      loader_dipper_yd3: 5,
      bucket_payload_t: 10,
      target_truck_payload_t: 90,
      observed_fill_factor: 0.9,
    });
    expect(m.recommended_truck_payload_t).toBeCloseTo(9.0 * Math.pow(5, 1.1), 1);
    expect(m.nine_to_one_payload_t).toBe(90);
    expect(m.fill_factor_ok).toBe(true);
    const bad = matchLoaderToTruck({
      loader_dipper_yd3: 5,
      bucket_payload_t: 10,
      target_truck_payload_t: 90,
      observed_fill_factor: 0.5,
    });
    expect(bad.fill_factor_ok).toBe(false);
  });

  it('fleet sizing (§3.2): drill rule of thumb by tpd', () => {
    const small = sizeFleet({ daily_tonnage_tpd: 10_000, loader_productivity_tph: 500, truck_productivity_tph: 200, working_hours_per_day: 20 });
    expect(small.drills).toBe(2);
    const big = sizeFleet({ daily_tonnage_tpd: 80_000, loader_productivity_tph: 1000, truck_productivity_tph: 400, working_hours_per_day: 20 });
    expect(big.drills).toBe(4);
    expect(big.loaders).toBeGreaterThanOrEqual(1);
    expect(big.trucks).toBeGreaterThanOrEqual(1);
  });

  it('genset load band (§3.3): wet-stacking < 40%, life-loss > 90%', () => {
    expect(sizeGenset({ expected_load_kw: 200, rating_kw: 1000, duty: 'prime' }).verdict).toBe('wet_stacking_risk');
    expect(sizeGenset({ expected_load_kw: 950, rating_kw: 1000, duty: 'prime' }).verdict).toBe('life_loss_risk');
    expect(sizeGenset({ expected_load_kw: 750, rating_kw: 1000, duty: 'prime' }).verdict).toBe('healthy');
  });

  it('lease-vs-buy (§4.5): high utilisation favours ownership', () => {
    const r = leaseVsBuy({
      purchase_price: 2_000_000,
      economic_life_years: 8,
      residual_value: 200_000,
      annual_owning_fixed_cost: 100_000,
      operating_cost_per_hour: 80,
      rental_rate_per_hour: 250,
      expected_hours_per_year: 3000,
    });
    expect(r.verdict).toBe('buy_finance');
    expect(r.breakeven_hours_per_year).toBeGreaterThan(0);
    expect(r.aisc_note).toMatch(/AISC/);
  });

  it('lease-vs-buy: low utilisation favours rental', () => {
    const r = leaseVsBuy({
      purchase_price: 2_000_000,
      economic_life_years: 8,
      residual_value: 200_000,
      annual_owning_fixed_cost: 100_000,
      operating_cost_per_hour: 80,
      rental_rate_per_hour: 250,
      expected_hours_per_year: 300,
    });
    expect(r.verdict).toBe('lease');
  });

  it('TCO scorer (§5.1): currency-agnostic, lower TCO + dealer + warranty wins', () => {
    const ranking = rankSuppliersByTco([
      {
        supplier_id: 'a',
        sticker_price: 1_000_000,
        est_lifetime_fuel_cost: 900_000,
        est_lifetime_parts_cost: 900_000,
        parts_lead_time_days: 120,
        warranty_months: 6,
        in_country_dealer: false,
        local_content_pct: 0,
      },
      {
        supplier_id: 'b',
        sticker_price: 1_300_000,
        est_lifetime_fuel_cost: 400_000,
        est_lifetime_parts_cost: 300_000,
        parts_lead_time_days: 10,
        warranty_months: 24,
        in_country_dealer: true,
        local_content_pct: 60,
      },
    ]);
    expect(ranking.winner_id).toBe('b');
    const loser = ranking.ranked.find((r) => r.supplier_id === 'a');
    expect(loser?.flags).toContain('no in-country dealer presence');
  });

  it('empty bid list yields no winner but still carries dossier evidence', () => {
    const ranking = rankSuppliersByTco([]);
    expect(ranking.winner_id).toBeNull();
    expect(ranking.evidence_ids).toContain(MMA_EVIDENCE.tcoNotSticker);
  });

  it('failure-mode crib sheet carries asset-class-specific modes', () => {
    expect(failureModesFor('sag_mill').some((m) => /trunnion-bearing/.test(m.mode))).toBe(true);
    expect(failureModesFor('slurry_pump').some((m) => /throatbush/.test(m.mode))).toBe(true);
    expect(failureModesFor('genset').some((m) => /wet-stacking/.test(m.mode))).toBe(true);
  });
});
