import { describe, it, expect } from 'vitest';
import { createMarketingBrainMiningAgent } from '../../src/juniors/marketing-brain-mining.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  title: 'Q1 Update',
  body_md: '# Q1\n\nIndicative outlook.',
  target_audience: 'investor',
  language: 'en',
  word_count: 50,
  confidence: 0.75,
  rationale: 'composed from corpus + sales advice',
  evidence_ids: ['corpus_q1'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', target_audience: 'investor' as const, topic: 'Q1 update', language: 'en' as const,
};

describe('marketing-brain-mining', () => {
  it('happy path returns markdown body with evidence_ids', async () => {
    const agent = createMarketingBrainMiningAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.title).toBe('Q1 Update');
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createMarketingBrainMiningAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('corpus_lookup_fail'); } };
    const agent = createMarketingBrainMiningAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/corpus_lookup_fail/);
  });
});
