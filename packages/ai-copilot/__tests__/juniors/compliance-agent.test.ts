import { describe, it, expect } from 'vitest';
import { createComplianceAgent } from '../../src/juniors/compliance-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  compliant: true,
  blocking_regulators: [],
  citations: [
    { rule_key: 'mining_act_2010_s7', passage: 'Mining Act 2010 §7', gazette_number: 'GN-001/2025' },
  ],
  required_actions: [],
  confidence: 0.9,
  rationale: 'no blockers',
  evidence_ids: ['rule_lookup_x'],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1',
  action: { action_kind: 'export', description: 'gold export to UAE' },
  context: {},
};

describe('compliance-agent', () => {
  it('happy path returns verdict with evidence_ids', async () => {
    const agent = createComplianceAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.compliant).toBe(true);
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createComplianceAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('citation_lookup_fail'); } };
    const agent = createComplianceAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/citation_lookup_fail/);
  });
});
