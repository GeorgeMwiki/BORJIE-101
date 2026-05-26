import { describe, it, expect } from 'vitest';
import { createTutoringSkillPackMiningAgent } from '../../src/juniors/tutoring-skill-pack-mining.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  tutorials: [{
    title: 'Renew your PML',
    body_md: 'File T-90 packet now.',
    action_url: '/onboarding/pml/renew',
    priority: 'urgent',
  }],
  confidence: 0.7,
  rationale: 'upcoming deadline',
  evidence_ids: ['deadline_pml_001'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', owner_id: 'o1', current_step: 'pml_active', language: 'en' as const,
};

describe('tutoring-skill-pack-mining', () => {
  it('happy path returns tutorial cards with evidence_ids', async () => {
    const agent = createTutoringSkillPackMiningAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.tutorials.length).toBeGreaterThan(0);
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createTutoringSkillPackMiningAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('onboarding_read_fail'); } };
    const agent = createTutoringSkillPackMiningAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/onboarding_read_fail/);
  });
});
