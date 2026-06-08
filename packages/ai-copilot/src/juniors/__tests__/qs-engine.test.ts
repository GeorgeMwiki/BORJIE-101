import { describe, it, expect } from 'vitest';
import {
  buildCostPlan,
  buildUnitRate,
  computeEvm,
  reconcileFinalAccount,
  retentionReleaseSchedule,
  valuateIpc,
  valuateVariation,
} from '../qs-engine.js';

describe('qs-engine — NRM2 rate build-up (§2.2)', () => {
  it('builds a first-principles unit rate, prelims excluded', () => {
    const r = buildUnitRate({
      labour_all_in_rate: 10,
      labour_hours_per_unit: 2, // 20
      material_cost_per_unit: 100,
      plant_cost_per_unit: 5,
      waste_fraction: 0.1, // material → 110
      ohp_fraction: 0.15, // (20+110+5)=135 → ohp 20.25
    });
    expect(r.labour).toBe(20);
    expect(r.material_with_waste).toBe(110);
    expect(r.net_cost).toBe(135);
    expect(r.ohp).toBe(20.25);
    expect(r.unit_rate).toBe(155.25);
  });

  it('rejects negative waste/ohp fractions', () => {
    expect(() =>
      buildUnitRate({
        labour_all_in_rate: 1,
        labour_hours_per_unit: 1,
        material_cost_per_unit: 1,
        plant_cost_per_unit: 0,
        waste_fraction: -0.1,
        ohp_fraction: 0.1,
      }),
    ).toThrow(/waste_fraction/);
  });
});

describe('qs-engine — NRM1 cost plan', () => {
  it('stacks prelims, fees, risk and inflation in order', () => {
    const plan = buildCostPlan({
      measured_works: [
        { code: 'A', description: 'substructure', quantity: 100, unit: 'm3', rate: 10 }, // 1000
        { code: 'B', description: 'frame', quantity: 50, unit: 'm2', rate: 20 }, // 1000
      ],
      preliminaries: 200, // 2200
      fees_fraction: 0.1, // 220 → subtotal 2420
      risk_fraction: 0.05, // 121 → 2541
      inflation_fraction: 0.03, // 76.23
    });
    expect(plan.measured_works_total).toBe(2000);
    expect(plan.works_plus_prelims).toBe(2200);
    expect(plan.fees).toBe(220);
    expect(plan.risk_allowance).toBe(121);
    expect(plan.inflation_allowance).toBe(76.23);
    expect(plan.base_cost).toBe(2617.23);
    expect(plan.elemental_breakdown).toHaveLength(2);
  });
});

describe('qs-engine — §5 IPC valuation + retention', () => {
  it('computes gross→net with retention and prior-cert deduction', () => {
    const ipc = valuateIpc({
      work_done_to_date: 100_000,
      materials_on_site: 20_000,
      variations_to_date: 5_000, // gross 125000
      retention_fraction: 0.05, // 6250
      retention_limit_fraction: 0.05,
      contract_sum: 500_000, // cap 25000 → not hit
      previously_certified: 80_000,
    });
    expect(ipc.gross_valuation).toBe(125_000);
    expect(ipc.retention_held).toBe(6_250);
    expect(ipc.retention_capped).toBe(false);
    expect(ipc.net_after_retention).toBe(118_750);
    expect(ipc.net_due_this_certificate).toBe(38_750);
  });

  it('caps retention at the contractual limit', () => {
    const ipc = valuateIpc({
      work_done_to_date: 480_000,
      materials_on_site: 0,
      variations_to_date: 0, // gross 480000
      retention_fraction: 0.1, // uncapped 48000
      retention_limit_fraction: 0.05,
      contract_sum: 500_000, // cap 25000
      previously_certified: 0,
    });
    expect(ipc.retention_held).toBe(25_000);
    expect(ipc.retention_capped).toBe(true);
  });

  it('releases retention half at PC, half at making-good-defects', () => {
    const rel = retentionReleaseSchedule(25_000);
    expect(rel.at_practical_completion).toBe(12_500);
    expect(rel.at_making_good_defects).toBe(12_500);
  });
});

describe('qs-engine — §5 variation valuation', () => {
  it('values BOQ-rate variations', () => {
    expect(valuateVariation({ quantity: 10, rate: 50, basis: 'boq_rate' })).toEqual({
      basis: 'boq_rate',
      value: 500,
    });
  });

  it('values dayworks as prime cost + percentage addition', () => {
    const v = valuateVariation({
      basis: 'dayworks',
      quantity: 0,
      dayworks: { labour: 100, plant: 50, materials: 50, percentage_addition: 0.15 },
    });
    expect(v.value).toBe(230); // 200 * 1.15
  });

  it('throws when rate missing for a rate-based variation', () => {
    expect(() => valuateVariation({ quantity: 1, basis: 'fair_rate' })).toThrow(/rate required/);
  });

  it('throws when dayworks build-up missing', () => {
    expect(() => valuateVariation({ quantity: 1, basis: 'dayworks' })).toThrow(/dayworks build-up required/);
  });
});

describe('qs-engine — §5 final account', () => {
  it('reconciles to a final contract sum and residual balance', () => {
    const fa = reconcileFinalAccount({
      original_contract_sum: 1_000_000,
      remeasured_adjustment: 20_000,
      total_variations: 50_000,
      settled_claims: 10_000,
      fluctuations: 5_000, // final 1,085,000
      total_certified_to_date: 1_050_000,
    });
    expect(fa.final_contract_sum).toBe(1_085_000);
    expect(fa.balance_to_release).toBe(35_000);
    expect(fa.variance_vs_original).toBe(85_000);
    expect(fa.variance_vs_original_pct).toBe(8.5);
  });
});

describe('qs-engine — §8.1 EVM', () => {
  it('computes CPI/SPI/EAC and reads cost+schedule together', () => {
    const evm = computeEvm({
      planned_value: 100,
      earned_value: 90,
      actual_cost: 120,
      budget_at_completion: 1000,
    });
    expect(evm.cpi).toBe(0.75); // 90/120
    expect(evm.spi).toBe(0.9); // 90/100
    expect(evm.cost_status).toBe('over_budget');
    expect(evm.schedule_status).toBe('behind');
    expect(evm.estimate_at_completion).toBe(1333.33); // 1000/0.75
  });

  it('flags the under-budget-but-behind case', () => {
    const evm = computeEvm({
      planned_value: 100,
      earned_value: 80,
      actual_cost: 70,
      budget_at_completion: 1000,
    });
    expect(evm.cost_status).toBe('under_budget'); // CPI 1.143
    expect(evm.schedule_status).toBe('behind'); // SPI 0.8
  });

  it('guards division by zero before work starts', () => {
    const evm = computeEvm({ planned_value: 0, earned_value: 0, actual_cost: 0, budget_at_completion: 1000 });
    expect(evm.cpi).toBe(0);
    expect(evm.spi).toBe(0);
    expect(evm.estimate_at_completion).toBe(1000);
  });
});
