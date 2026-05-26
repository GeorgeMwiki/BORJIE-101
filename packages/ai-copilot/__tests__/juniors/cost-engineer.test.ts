import { describe, it, expect } from 'vitest';
import { createCostEngineerAgent } from '../../src/juniors/cost-engineer.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  unit_economics: {
    tzs_per_metre: 1000, tzs_per_bcm: 500, tzs_per_tonne_rom: 800,
    tzs_per_tonne_milled: 1200, tzs_per_recoverable_unit: 50000,
  },
  break_even: { be_price_tzs: 100000, be_grade_pct_or_g_t: 2.5, sensitivity: [] },
  cash_runway_days: { best: 120, base: 90, worst: 45 },
  forecast: { d7: 100, d30: 400, d90: 1000 },
  by_product_credits_tzs: 0,
  confidence: 0.8,
  rationale: 'standard ROM/mill ratio',
  evidence_ids: ['cost_bucket_actual'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', siteId: 's1', mineral: 'Au', period_iso: '2026-03',
  tonnes_rom: 1000, tonnes_milled: 800, metres_advanced: 50, bcm_overburden: 200,
  recoverable_units: 30, recoverable_unit_label: 'g',
  costs: {
    actual_tzs: 5000000, forecast_tzs: 6000000, committed_tzs: 1000000,
    unpaid_tzs: 500000, disputed_tzs: 0, hidden_tzs: 0, document_blocked_tzs: 0,
  },
  current_price_per_unit_tzs: 200000,
};

describe('cost-engineer', () => {
  it('happy path returns unit_economics with evidence_ids', async () => {
    const agent = createCostEngineerAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.cash_runway_days.base).toBe(90);
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createCostEngineerAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('be_calc_fail'); } };
    const agent = createCostEngineerAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/be_calc_fail/);
  });
});
