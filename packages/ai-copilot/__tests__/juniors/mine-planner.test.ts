import { describe, it, expect } from 'vitest';
import { createMinePlanner } from '../../src/juniors/mine-planner.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const POLY = [
  { lat: -6.0, lng: 39.0 }, { lat: -6.0, lng: 39.1 },
  { lat: -6.1, lng: 39.1 }, { lat: -6.1, lng: 39.0 },
];

const VALID = {
  site_id: 's1',
  sections: [{ name: 'camp', polygon: POLY }],
  weekly_plan: {
    target_tonnes: 100, faces: ['F1'],
    assignments: [{ asset_id: 'EX-001', face: 'F1', hours: 8 }],
    blasts: [],
  },
  match_factor: 0.9,
  bottleneck: 'none',
  mechanisation_allowed: true,
  recommendations: [],
  confidence: 0.78,
  rationale: 'layout ok',
  evidence_ids: ['geology_score_1'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', siteId: 's1', mineral: 'Au',
  polygon: POLY,
  fleet: [{ asset_id: 'EX-001', kind: 'excavator' as const }],
  geology_score: 0.7,
};

describe('mine-planner', () => {
  it('happy path returns sections with evidence_ids', async () => {
    const agent = createMinePlanner({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.sections.length).toBeGreaterThan(0);
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createMinePlanner({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('sentinel_fail'); } };
    const agent = createMinePlanner({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/sentinel_fail/);
  });
});
