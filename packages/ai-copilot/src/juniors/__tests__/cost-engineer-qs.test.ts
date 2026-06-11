import { describe, it, expect } from 'vitest';
import { createCostEngineerAgent } from '../cost-engineer.js';
import type { ClaudeClient } from '../_shared.js';

// LLM port narration — deterministic fields are overridden by the junior,
// so the model only supplies commentary + audit envelope.
const NARRATION = {
  project_id: 'IGNORED',
  currency_code: 'XXX',
  task: 'cost_plan',
  riba_stage: 'stage_0_strategic_definition',
  computed: {},
  posts_to_ledger: false,
  qs_commentary: 'Substructure dominates the elemental plan.',
  stage_gate_warning: null,
  confidence: 0.82,
  rationale: 'NRM1 elemental cost plan narrated over verified figures.',
  evidence_ids: ['construction-built-environment.md#section-2'],
  citations: ['NRM1'],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

describe('cost-engineer QS — cost plan', () => {
  it('computes an NRM1 plan and overrides LLM deterministic fields', async () => {
    const agent = createCostEngineerAgent({ claude: claudeOf(NARRATION) });
    const out = await agent.processQs({
      tenantId: 't1',
      projectId: 'proj-camp-1',
      currency_code: 'TZS',
      riba_stage: 'stage_2_concept_design',
      task: 'cost_plan',
      cost_plan: {
        measured_works: [
          { code: 'A', description: 'substructure', quantity: 100, unit: 'm3', rate: 10 },
        ],
        preliminaries: 100,
        fees_fraction: 0.1,
        risk_fraction: 0.05,
        inflation_fraction: 0,
      },
    });
    // Deterministic identity fields win over the model's "IGNORED"/"XXX".
    expect(out.project_id).toBe('proj-camp-1');
    expect(out.currency_code).toBe('TZS');
    expect(out.riba_stage).toBe('stage_2_concept_design');
    expect(out.posts_to_ledger).toBe(false);
    const plan = (out.computed.cost_plan as { base_cost: number; measured_works_total: number });
    expect(plan.measured_works_total).toBe(1000);
    expect(plan.base_cost).toBeGreaterThan(1000);
  });

  it('builds the rate from first principles when no explicit rate given', async () => {
    const agent = createCostEngineerAgent({ claude: claudeOf(NARRATION) });
    const out = await agent.processQs({
      tenantId: 't1',
      projectId: 'p',
      currency_code: 'KES',
      riba_stage: 'stage_4_technical_design',
      task: 'cost_plan',
      cost_plan: {
        measured_works: [
          {
            code: 'C',
            description: 'rebar',
            quantity: 1,
            unit: 't',
            rate_buildup: {
              labour_all_in_rate: 10,
              labour_hours_per_unit: 2,
              material_cost_per_unit: 100,
              plant_cost_per_unit: 5,
              waste_fraction: 0.1,
              ohp_fraction: 0.15,
            },
          },
        ],
        preliminaries: 0,
        fees_fraction: 0,
        risk_fraction: 0,
        inflation_fraction: 0,
      },
    });
    const plan = out.computed.cost_plan as { measured_works_total: number };
    expect(plan.measured_works_total).toBe(155.25);
  });
});

describe('cost-engineer QS — money-flag is deterministic', () => {
  it('forces posts_to_ledger true for an IPC valuation even if the model says false', async () => {
    const agent = createCostEngineerAgent({ claude: claudeOf({ ...NARRATION, posts_to_ledger: false }) });
    const out = await agent.processQs({
      tenantId: 't1',
      projectId: 'p',
      currency_code: 'TZS',
      riba_stage: 'stage_5_manufacturing_construction',
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
    });
    expect(out.posts_to_ledger).toBe(true);
    const ipc = out.computed.ipc as { net_due_this_certificate: number };
    expect(ipc.net_due_this_certificate).toBe(95_000);
  });
});

describe('cost-engineer QS — guards', () => {
  it('throws when the task payload is missing', async () => {
    const agent = createCostEngineerAgent({ claude: claudeOf(NARRATION) });
    await expect(
      agent.processQs({
        tenantId: 't1',
        projectId: 'p',
        currency_code: 'TZS',
        riba_stage: 'stage_3_spatial_coordination',
        task: 'evm',
      }),
    ).rejects.toThrow(/evm payload required/);
  });

  it('rejects empty evidence_ids from the LLM (Auditor base)', async () => {
    const agent = createCostEngineerAgent({ claude: claudeOf({ ...NARRATION, evidence_ids: [] }) });
    await expect(
      agent.processQs({
        tenantId: 't1',
        projectId: 'p',
        currency_code: 'TZS',
        riba_stage: 'stage_2_concept_design',
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
});
