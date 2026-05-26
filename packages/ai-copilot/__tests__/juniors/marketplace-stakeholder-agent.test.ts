import { describe, it, expect } from 'vitest';
import { createMarketplaceStakeholderAgent } from '../../src/juniors/marketplace-stakeholder-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  mode: 'discovery',
  results: [{
    id: 'r1', kind: 'external_buyer', title: 'Buyer X',
    summary: 'gold buyer', kyc_status: 'verified',
  }],
  confidence: 0.7,
  rationale: 'discovery results',
  evidence_ids: ['kyc_r1'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', mode: 'discovery' as const, query: 'gold buyers Tanzania',
  participant_kind: 'external_buyer' as const, language: 'en' as const,
};

describe('marketplace-stakeholder-agent', () => {
  it('happy path returns discovery results with evidence_ids', async () => {
    const agent = createMarketplaceStakeholderAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createMarketplaceStakeholderAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('kyc_lookup_fail'); } };
    const agent = createMarketplaceStakeholderAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/kyc_lookup_fail/);
  });
});
