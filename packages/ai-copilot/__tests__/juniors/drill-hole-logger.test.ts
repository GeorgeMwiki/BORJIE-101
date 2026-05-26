import { describe, it, expect } from 'vitest';
import { createDrillHoleLogger } from '../../src/juniors/drill-hole-logger.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  hole_id: 'h_1',
  total_depth_m: 10,
  vein_intersects: 1,
  qa_flags: [],
  next_step_recommendation: 'sample top 5m',
  jorc_caveat: 'Not a JORC-compliant Mineral Resource Estimate without Competent Person sign-off.',
  layer_ids: ['lay_x'],
  confidence: 0.8,
  rationale: 'single hole',
  evidence_ids: ['layer_0'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', siteId: 's1', holeId: 'h_1', kind: 'pit' as const,
  gps: { lat: -6.7, lng: 39.2 },
  layers: [{ depth_from_m: 0, depth_to_m: 10, lithology: 'soil' }],
};

describe('drill-hole-logger', () => {
  it('happy path returns log with evidence_ids', async () => {
    const agent = createDrillHoleLogger({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.total_depth_m).toBe(10);
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createDrillHoleLogger({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('layer_qa_fail'); } };
    const agent = createDrillHoleLogger({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/layer_qa_fail/);
  });
});
