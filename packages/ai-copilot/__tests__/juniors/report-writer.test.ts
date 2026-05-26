import { describe, it, expect } from 'vitest';
import { createReportWriter } from '../../src/juniors/report-writer.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  cadence: 'daily_owner_brief',
  document_id: 'doc_x',
  title: 'Daily Brief',
  word_count: 200,
  language: 'en',
  body_markdown: '# Daily\n\nAll green.',
  cards: [],
  signed_url: null,
  confidence: 0.72,
  rationale: 'standard daily',
  evidence_ids: ['lmbm_card_x'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', cadence: 'daily_owner_brief' as const, audience: 'owner', language: 'en' as const,
};

describe('report-writer', () => {
  it('happy path returns body_markdown with evidence_ids', async () => {
    const agent = createReportWriter({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.cadence).toBe('daily_owner_brief');
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createReportWriter({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('lmbm_lookup_fail'); } };
    const agent = createReportWriter({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/lmbm_lookup_fail/);
  });
});
