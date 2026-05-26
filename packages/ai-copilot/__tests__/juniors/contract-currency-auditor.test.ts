import { describe, it, expect } from 'vitest';
import { createContractCurrencyAuditor } from '../../src/juniors/contract-currency-auditor.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  cliff_already_passed: true,
  total_contracts_scanned: 1,
  flagged_contracts: [],
  total_tra_exposure_tzs: 0,
  remediation_status: 'ok',
  next_actions: [],
  confidence: 0.88,
  rationale: 'no domestic USD contracts',
  evidence_ids: ['ev_scan_1'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1',
  contracts: [{
    contract_id: 'c1', counterparty_name: 'X', counterparty_is_tz_resident: true,
    signed_at: '2025-01-01', currency: 'TZS', amount: 1000, domestic: true, cross_border: false,
    evidence_id: 'ev_scan_1',
  }],
  current_bot_rate_tzs_per_usd: 2600,
};

describe('contract-currency-auditor', () => {
  it('happy path returns remediation_status with evidence_ids', async () => {
    const agent = createContractCurrencyAuditor({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.remediation_status).toBe('ok');
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createContractCurrencyAuditor({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('addendum_draft_fail'); } };
    const agent = createContractCurrencyAuditor({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/addendum_draft_fail/);
  });
});
