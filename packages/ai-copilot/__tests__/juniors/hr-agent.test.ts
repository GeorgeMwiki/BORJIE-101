import { describe, it, expect } from 'vitest';
import { createHrAgent } from '../../src/juniors/hr-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  reporting_month: '2026-03',
  headcount_total: 10,
  productivity_by_phase: [{ phase: 'production', headcount: 10, tonnes_per_worker_day: 1.5 }],
  local_content_check: {
    non_managerial_tz_pct: 100, senior_mgmt_tz_pct: 80, compliant: true, deviations: [],
  },
  attendance_outliers: [],
  advances_summary: { total_tzs: 0, employees_with_advances: 0 },
  reassignment_suggestions: [],
  confidence: 0.82,
  rationale: 'compliant',
  evidence_ids: ['emp_e1'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', reporting_month_iso: '2026-03',
  employees: [{
    employee_id: 'e1', full_name: 'A B', nationality: 'TZ', role: 'driver',
    attendance_last_30d: 28,
  }],
};

describe('hr-agent', () => {
  it('happy path returns compliance shape with evidence_ids', async () => {
    const agent = createHrAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.local_content_check.compliant).toBe(true);
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createHrAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('payroll_recon_fail'); } };
    const agent = createHrAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/payroll_recon_fail/);
  });
});
