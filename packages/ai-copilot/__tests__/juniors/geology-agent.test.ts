import { describe, it, expect } from 'vitest';
import { createGeologyAgent } from '../../src/juniors/geology-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  site_id: 's1',
  geology_score: 0.4,
  score_band: 'sampled',
  next_step: { method: 'rc_holes', cost_tzs: 5000000, expected_score_lift: 0.2 },
  vein_model_stub: null,
  jorc_caveat: 'Not a JORC-compliant Mineral Resource Estimate without Competent Person sign-off.',
  confidence: 0.72,
  rationale: 'limited surface evidence',
  evidence_ids: ['mineral_dossier_au'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', siteId: 's1', mineral: 'Au',
  observations: {
    visual_outcrop: true, surface_samples_assayed: 2, hand_shafts: 0,
    rc_holes: 0, diamond_core_metres: 0, competent_person_signoff: false,
  },
};

describe('geology-agent', () => {
  it('happy path returns score and band with evidence_ids', async () => {
    const agent = createGeologyAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.score_band).toBe('sampled');
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createGeologyAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('triangulation_fail'); } };
    const agent = createGeologyAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/triangulation_fail/);
  });
});
