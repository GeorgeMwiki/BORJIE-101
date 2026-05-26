import { describe, it, expect } from 'vitest';
import { createOperationsSicAgent } from '../../src/juniors/operations-sic-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  shift_id: 'sh_1',
  mode: 'pre_shift',
  deviation_code: 'none',
  variance_tonnes: 0,
  variance_pct: 0,
  explanation_swahili: 'Mpango wa zamu unaonekana sawa.',
  explanation_english: 'Shift plan looks fine.',
  root_cause_chain: [],
  tomorrow_plan_draft: null,
  excavator_idle_alert: false,
  confidence: 0.72,
  rationale: 'pre-shift plan emitted',
  evidence_ids: ['sh_1'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', siteId: 's1', shiftId: 'sh_1', mode: 'pre_shift' as const,
  supervisor_id: 'sup1', payload: { plan_target_tonnes: 100, plan_machine_hours: 8 },
};

describe('operations-sic-agent', () => {
  it('happy path returns plan with evidence_ids', async () => {
    const agent = createOperationsSicAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.deviation_code).toBe('none');
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createOperationsSicAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('sic_loop_fail'); } };
    const agent = createOperationsSicAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/sic_loop_fail/);
  });
});
