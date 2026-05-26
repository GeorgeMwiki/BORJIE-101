import { describe, it, expect } from 'vitest';
import { createCommunityAgent } from '../../src/juniors/community-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  grievance_summary: { open: 1, in_mediation: 0, resolved: 0, escalated: 0 },
  high_priority_grievances: ['gr_1'],
  csr_delivery_gap_pct: 12,
  meeting_minutes_required: [],
  next_actions_swahili: ['Mkutano wa kijiji'],
  next_actions_english: ['Village meeting'],
  confidence: 0.78,
  rationale: 'open grievance triaged',
  evidence_ids: ['gr_1'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = { tenantId: 't1' };

describe('community-agent', () => {
  it('happy path returns triage shape with evidence_ids', async () => {
    const agent = createCommunityAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.grievance_summary.open).toBe(1);
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createCommunityAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('translation_fail'); } };
    const agent = createCommunityAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/translation_fail/);
  });
});
