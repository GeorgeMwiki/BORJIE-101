import { describe, it, expect } from 'vitest';
import { createRiskModeler } from '../../src/juniors/risk-modeler.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  composite_score_0_100: 45,
  band: 'amber',
  category_scores: [{ category: 'safety', score_0_100: 30, top_drivers: ['ppe_compliance'] }],
  top_5_risks: [{ factor_key: 'ppe', category: 'safety', severity: 30, mitigation: 'refresh PPE' }],
  recommended_escalations: [],
  confidence: 0.74,
  rationale: 'amber composite',
  evidence_ids: ['factor_ppe'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1',
  factors: [{
    factor_key: 'ppe', category: 'safety' as const, weight: 1.0,
    raw_score_0_100: 30, evidence_id: 'factor_ppe',
  }],
};

describe('risk-modeler', () => {
  it('happy path returns composite + band with evidence_ids', async () => {
    const agent = createRiskModeler({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.band).toBe('amber');
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createRiskModeler({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('factor_lookup_fail'); } };
    const agent = createRiskModeler({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/factor_lookup_fail/);
  });
});
