import { describe, it, expect } from 'vitest';
import { createVillageCsrAgent } from '../../src/juniors/village-csr-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  licence_id: 'l1',
  overall_delivery_pct: 75,
  delivery_by_kind: [{ kind: 'borehole', delivered_pct: 75, total_budget_tzs: 2_000_000 }],
  csr_clock_status: 'in_committee',
  next_milestone_due: '2026-04-15',
  flagged_commitments: [],
  fingerprint_letter_required: true,
  confidence: 0.78,
  rationale: 'committee phase ongoing',
  evidence_ids: ['cmt_c1'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', licenceId: 'l1',
  commitments: [{
    commitment_id: 'c1', village_id: 'v1', kind: 'borehole' as const,
    budget_tzs: 2_000_000, promised_at: '2026-01-01', due_at: '2026-05-01',
    delivered_pct: 75,
  }],
  csr_plan_filed_at: '2026-01-15', committee_meeting_at: null,
  council_meeting_at: null, minister_review_at: null,
};

describe('village-csr-agent', () => {
  it('happy path returns delivery_by_kind with evidence_ids', async () => {
    const agent = createVillageCsrAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.csr_clock_status).toBe('in_committee');
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createVillageCsrAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('meeting_schedule_fail'); } };
    const agent = createVillageCsrAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/meeting_schedule_fail/);
  });
});
