import { describe, it, expect } from 'vitest';
import { createLicenceAgent } from '../../src/juniors/licence-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  licence_id: 'l_1',
  renewal_calendar: [
    { label: 'T-90', date: '2026-12-15', status: 'upcoming', required_actions: ['file EPP'] },
  ],
  dormancy_score: 25,
  dormancy_factors: {
    last_payment_age_days: 30, last_report_age_days: 45,
    work_programme_variance_pct: 5, area_utilisation_pct: 60, epp_filed: true,
  },
  payment_history_pack: [],
  dormancy_alert_level: 'green',
  confidence: 0.86,
  rationale: 'no immediate risk',
  evidence_ids: ['licence_l_1'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', licenceId: 'l_1', licenceNo: 'PML-001/2025', kind: 'PML' as const,
  grantDate: '2025-03-15', expiryDate: '2032-03-14',
  lastPaymentDate: '2026-02-28', lastWorkProgrammeReportDate: '2026-02-15',
  eppFiledAt: '2026-01-10', areaUtilisationPct: 60,
};

describe('licence-agent', () => {
  it('happy path returns calendar with evidence_ids', async () => {
    const agent = createLicenceAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.dormancy_alert_level).toBe('green');
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createLicenceAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('cadastre_unreachable'); } };
    const agent = createLicenceAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/cadastre_unreachable/);
  });
});
