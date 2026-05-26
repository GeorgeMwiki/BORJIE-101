import { describe, it, expect } from 'vitest';
import { createLabAssayAgent } from '../../src/juniors/lab-assay-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  batch_id: 'b_1',
  recommended_lab: 'SGS_MWANZA',
  recommended_technique: 'fire assay (50 g)',
  estimated_cost_tzs: 250000,
  estimated_turnaround_days: 10,
  manifest_with_qaqc: [
    { sample_id: 's_1', kind: 'field', tag_codes: ['a', 'b', 'c'] },
  ],
  qaqc_passed: true,
  qaqc_failures: [],
  confidence: 0.85,
  rationale: 'standard Au flow',
  evidence_ids: ['mineral_dossier_au', 'sample_s_1'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', siteId: 's1', batchId: 'b_1', mineral: 'Au',
  samples: [{ sample_id: 's_1', mass_kg: 2 }],
};

describe('lab-assay-agent', () => {
  it('happy path returns manifest with evidence_ids', async () => {
    const agent = createLabAssayAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.recommended_lab).toBe('SGS_MWANZA');
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createLabAssayAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('lab_quote_fail'); } };
    const agent = createLabAssayAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/lab_quote_fail/);
  });
});
