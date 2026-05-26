import { describe, it, expect } from 'vitest';
import { createBuyerKycAgent } from '../../src/juniors/buyer-kyc-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  buyer_id: 'b_1',
  kyc_status: 'approved',
  nida_check: { attempted: true, passed: true },
  tin_check: { attempted: true, passed: true },
  brela_check: { attempted: false, passed: false },
  aml_flags: [],
  required_documents: [],
  oecd_due_diligence_band: 'low',
  confidence: 0.91,
  rationale: 'all checks pass',
  evidence_ids: ['nida_ref_x', 'tin_ref_y'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', buyer_id: 'b_1', legal_name: 'Acme', buyer_type: 'company' as const,
};

describe('buyer-kyc-agent', () => {
  it('happy path returns approved buyer with evidence_ids', async () => {
    const agent = createBuyerKycAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.kyc_status).toBe('approved');
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createBuyerKycAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('nida_unreachable'); } };
    const agent = createBuyerKycAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/nida_unreachable/);
  });
});
