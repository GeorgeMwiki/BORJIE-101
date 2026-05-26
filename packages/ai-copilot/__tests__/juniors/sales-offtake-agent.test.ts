import { describe, it, expect } from 'vitest';
import { createSalesOfftakeAgent } from '../../src/juniors/sales-offtake-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  parcel_id: 'p1',
  buyer_comparison: [{
    buyer_id: 'b1', net_price_tzs: 200_000_000, cash_conversion_days: 1, deductions_tzs: 0,
  }],
  recommended_buyer_id: 'b1',
  recommendation_reason: 'shortest cash conversion',
  mtc_preflight_required: true,
  mtc_documents_needed: ['MTC-001'],
  confidence: 0.8,
  rationale: 'BoT route is fastest',
  evidence_ids: ['pml_source_x'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1',
  parcel: { parcel_id: 'p1', source_pml: 'PML-1', mineral: 'Au', mass_g_or_t: 100 },
  buyers: [{
    buyer_id: 'b1', name: 'BoT', route: 'BoT' as const, payment_terms_days: 1,
  }],
  current_bot_rate_tzs_per_usd: 2600,
};

describe('sales-offtake-agent', () => {
  it('happy path returns buyer recommendation with evidence_ids', async () => {
    const agent = createSalesOfftakeAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.recommended_buyer_id).toBe('b1');
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createSalesOfftakeAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('mtc_pack_fail'); } };
    const agent = createSalesOfftakeAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/mtc_pack_fail/);
  });
});
