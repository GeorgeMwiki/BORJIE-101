import { describe, it, expect } from 'vitest';
import { createSafetyAgent } from '../../src/juniors/safety-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  site_id: 's1',
  critical_controls: [{ control: 'PPE', status: 'effective' }],
  incident_heatmap: [],
  ppe_compliance_pct: 95,
  immediate_alerts: [],
  required_actions: [],
  confidence: 0.86,
  rationale: 'no incidents reported',
  evidence_ids: ['inv_check_1'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = { tenantId: 't1', siteId: 's1' };

describe('safety-agent', () => {
  it('happy path returns critical_controls with evidence_ids', async () => {
    const agent = createSafetyAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.ppe_compliance_pct).toBe(95);
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createSafetyAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('icmm_lookup_fail'); } };
    const agent = createSafetyAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/icmm_lookup_fail/);
  });
});
