import { describe, it, expect } from 'vitest';
import { createFxTreasuryAgent } from '../../src/juniors/fx-treasury-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  mode: 'rate_check',
  recommendation: 'hold_pending_evidence',
  usd_contracts_to_convert: [],
  cliff_date: '2026-03-27',
  days_to_cliff: 0,
  confidence: 0.8,
  rationale: 'rate snapshot only',
  evidence_ids: ['bot_rate_ts'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', mode: 'rate_check' as const, current_bot_rate_tzs_per_usd: 2600,
};

describe('fx-treasury-agent', () => {
  it('happy path returns recommendation with evidence_ids', async () => {
    const agent = createFxTreasuryAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.cliff_date).toBe('2026-03-27');
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createFxTreasuryAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('bot_feed_down'); } };
    const agent = createFxTreasuryAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/bot_feed_down/);
  });
});
