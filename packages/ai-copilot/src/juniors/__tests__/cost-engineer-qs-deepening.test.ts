/**
 * Deepening tests for the Cost Engineer QS capability (`processQs`) — the
 * RICS NRM1/NRM2 + post-contract money machine + EVM wired to
 * `qs-engine.ts`. Covers the deterministic-authority override, every QS
 * task, the money-path ledger flag, the RIBA stage-gate guard and the
 * Auditor evidence base.
 *
 * The pure `qs-engine` math is unit-tested separately (qs-engine.test.ts);
 * here we test the JUNIOR CONTRACT: deterministic override, dispatch, and
 * governance flags, with a mocked Claude client.
 */

import { describe, it, expect } from 'vitest';
import type { ClaudeClient } from '../_shared.js';
import { createCostEngineerAgent, runQsTask, type QsInput } from '../cost-engineer.js';

const NARRATION = {
  project_id: 'IGNORED',
  currency_code: 'XXX',
  riba_stage: 'stage_0_strategic_definition',
  task: 'cost_plan',
  computed: { tampered: true },
  posts_to_ledger: false,
  qs_commentary: 'narration',
  stage_gate_warning: 'IGNORED',
  confidence: 0.82,
  rationale: 'QS narration over verified figures.',
  evidence_ids: ['construction-built-environment.md#section-5'],
  citations: ['NRM2'],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

// ─────────────────────────────────────────────────────────────────────
// runQsTask — pure dispatch (no LLM)
// ─────────────────────────────────────────────────────────────────────

describe('runQsTask (pure dispatch)', () => {
  const base = { tenantId: 't', projectId: 'p', currency_code: 'TZS', riba_stage: 'stage_5_manufacturing_construction' } as const;

  it('values an IPC and attaches the retention-release schedule', () => {
    const out = runQsTask({
      ...base,
      task: 'ipc_valuation',
      ipc: {
        work_done_to_date: 100_000,
        materials_on_site: 0,
        variations_to_date: 0,
        retention_fraction: 0.05,
        retention_limit_fraction: 0.05,
        contract_sum: 500_000,
        previously_certified: 0,
      },
    } as QsInput);
    const ipc = out.ipc as { net_due_this_certificate: number; retention_held: number };
    const rr = out.retention_release as { at_practical_completion: number; at_making_good_defects: number };
    expect(ipc.net_due_this_certificate).toBe(95_000);
    expect(ipc.retention_held).toBe(5_000);
    // Half at PC, balance at making-good-defects.
    expect(rr.at_practical_completion).toBe(2_500);
    expect(rr.at_making_good_defects).toBe(2_500);
  });

  it('values a dayworks variation (prime cost + percentage addition)', () => {
    const out = runQsTask({
      ...base,
      task: 'variation',
      variation: { quantity: 0, basis: 'dayworks', dayworks: { labour: 100, plant: 50, materials: 50, percentage_addition: 0.15 } },
    } as QsInput);
    // prime 200 * 1.15 = 230
    expect((out.variation as { value: number }).value).toBe(230);
  });

  it('reconciles a final account and flags the variance', () => {
    const out = runQsTask({
      ...base,
      task: 'final_account',
      final_account: {
        original_contract_sum: 1_000_000,
        remeasured_adjustment: 0,
        total_variations: 150_000,
        settled_claims: 0,
        fluctuations: 0,
        total_certified_to_date: 1_100_000,
      },
    } as QsInput);
    const fa = out.final_account as { final_contract_sum: number; variance_vs_original_pct: number; balance_to_release: number };
    expect(fa.final_contract_sum).toBe(1_150_000);
    expect(fa.variance_vs_original_pct).toBe(15);
    expect(fa.balance_to_release).toBe(50_000);
  });

  it('computes EVM (CPI/SPI read together)', () => {
    const out = runQsTask({
      ...base,
      task: 'evm',
      evm: { planned_value: 100, earned_value: 90, actual_cost: 120, budget_at_completion: 1000 },
    } as QsInput);
    const evm = out.evm as { cpi: number; spi: number; cost_status: string; schedule_status: string };
    expect(evm.cpi).toBe(0.75); // 90/120 → over budget
    expect(evm.spi).toBe(0.9); // 90/100 → behind
    expect(evm.cost_status).toBe('over_budget');
    expect(evm.schedule_status).toBe('behind');
  });

  it('throws a typed payload-required error per task', () => {
    expect(() => runQsTask({ ...base, task: 'ipc_valuation' } as QsInput)).toThrow(/ipc_valuation payload required/);
    expect(() => runQsTask({ ...base, task: 'variation' } as QsInput)).toThrow(/variation payload required/);
    expect(() => runQsTask({ ...base, task: 'final_account' } as QsInput)).toThrow(/final_account payload required/);
  });

  it('builds a measured-line rate from first principles when no rate is given', () => {
    const out = runQsTask({
      ...base,
      riba_stage: 'stage_4_technical_design',
      task: 'cost_plan',
      cost_plan: {
        measured_works: [
          {
            code: 'C',
            description: 'rebar',
            quantity: 2,
            unit: 't',
            // rate = (10*2 labour + 100*1.1 material + 5 plant)=135 → *1.15 OH&P = 155.25
            rate_buildup: { labour_all_in_rate: 10, labour_hours_per_unit: 2, material_cost_per_unit: 100, plant_cost_per_unit: 5, waste_fraction: 0.1, ohp_fraction: 0.15 },
          },
        ],
        preliminaries: 0,
        fees_fraction: 0,
        risk_fraction: 0,
        inflation_fraction: 0,
      },
    } as QsInput);
    // 2 t * 155.25 = 310.5
    expect((out.cost_plan as { measured_works_total: number }).measured_works_total).toBe(310.5);
  });
});

// ─────────────────────────────────────────────────────────────────────
// processQs — junior contract (deterministic authority + governance)
// ─────────────────────────────────────────────────────────────────────

describe('cost-engineer processQs (deterministic authority)', () => {
  it('OVERWRITES every LLM-echoed field with the engine truth', async () => {
    const agent = createCostEngineerAgent({ claude: claudeOf(NARRATION) });
    const out = await agent.processQs({
      tenantId: 't1',
      projectId: 'proj-plant-A',
      currency_code: 'KES',
      riba_stage: 'stage_5_manufacturing_construction',
      task: 'ipc_valuation',
      ipc: {
        work_done_to_date: 200_000,
        materials_on_site: 0,
        variations_to_date: 0,
        retention_fraction: 0.05,
        retention_limit_fraction: 0.05,
        contract_sum: 1_000_000,
        previously_certified: 0,
      },
    });
    // Identity + ledger flag are deterministic, not the model's "IGNORED"/"XXX"/false.
    expect(out.project_id).toBe('proj-plant-A');
    expect(out.currency_code).toBe('KES');
    expect(out.posts_to_ledger).toBe(true); // IPC is a money event
    // The model's tampered `computed` is replaced by the real engine output.
    expect((out.computed.ipc as { net_due_this_certificate: number }).net_due_this_certificate).toBe(190_000);
    expect(out.computed.tampered).toBeUndefined();
    // Stage 5 is construction-ready → no stage-gate warning.
    expect(out.stage_gate_warning).toBeNull();
  });

  it('raises a stage-gate warning for a money event on an early-stage design', async () => {
    const agent = createCostEngineerAgent({ claude: claudeOf(NARRATION) });
    const out = await agent.processQs({
      tenantId: 't1',
      projectId: 'p',
      currency_code: 'TZS',
      riba_stage: 'stage_2_concept_design', // too early to certify money
      task: 'final_account',
      final_account: {
        original_contract_sum: 100,
        remeasured_adjustment: 0,
        total_variations: 0,
        settled_claims: 0,
        fluctuations: 0,
        total_certified_to_date: 0,
      },
    });
    expect(out.posts_to_ledger).toBe(true);
    expect(out.stage_gate_warning).toMatch(/Stage-gate breach/);
  });

  it('does not flag the ledger for a non-money task (cost_plan / EVM)', async () => {
    const agent = createCostEngineerAgent({ claude: claudeOf(NARRATION) });
    const out = await agent.processQs({
      tenantId: 't1',
      projectId: 'p',
      currency_code: 'TZS',
      riba_stage: 'stage_3_spatial_coordination',
      task: 'evm',
      evm: { planned_value: 100, earned_value: 110, actual_cost: 100, budget_at_completion: 1000 },
    });
    expect(out.posts_to_ledger).toBe(false);
    expect(out.stage_gate_warning).toBeNull();
    expect((out.computed.evm as { cost_status: string }).cost_status).toBe('under_budget');
  });

  it('rejects empty evidence_ids from the LLM port (Auditor base)', async () => {
    const agent = createCostEngineerAgent({ claude: claudeOf({ ...NARRATION, evidence_ids: [] }) });
    await expect(
      agent.processQs({
        tenantId: 't1',
        projectId: 'p',
        currency_code: 'TZS',
        riba_stage: 'stage_4_technical_design',
        task: 'cost_plan',
        cost_plan: {
          measured_works: [{ code: 'A', description: 'x', quantity: 1, unit: 'm', rate: 1 }],
          preliminaries: 0,
          fees_fraction: 0,
          risk_fraction: 0,
          inflation_fraction: 0,
        },
      }),
    ).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('qs_narration_down'); } };
    const agent = createCostEngineerAgent({ claude });
    await expect(
      agent.processQs({
        tenantId: 't1',
        projectId: 'p',
        currency_code: 'TZS',
        riba_stage: 'stage_5_manufacturing_construction',
        task: 'variation',
        variation: { quantity: 10, rate: 50, basis: 'boq_rate' },
      }),
    ).rejects.toThrow(/qs_narration_down/);
  });

  it('throws before any LLM call when the task payload is missing', async () => {
    const agent = createCostEngineerAgent({ claude: claudeOf(NARRATION) });
    await expect(
      agent.processQs({
        tenantId: 't1',
        projectId: 'p',
        currency_code: 'TZS',
        riba_stage: 'stage_5_manufacturing_construction',
        task: 'ipc_valuation',
      }),
    ).rejects.toThrow(/ipc_valuation payload required/);
  });
});
