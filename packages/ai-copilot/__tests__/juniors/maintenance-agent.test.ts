import { describe, it, expect } from 'vitest';
import { createMaintenanceAgent } from '../../src/juniors/maintenance-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  asset_id: 'EX-001',
  next_service_interval_hours: 250,
  hours_until_service: 50,
  fuel_burn_l_per_hour: 22,
  downtime_hours_last_30d: 4,
  downtime_cost_estimate_usd: 1600,
  parts_list: ['hydraulic_filter'],
  oil_analysis_recommended: true,
  vibration_puck_recommended: false,
  confidence: 0.78,
  rationale: 'normal service window',
  evidence_ids: ['oem_caterpillar_320'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', asset_id: 'EX-001', oem: 'Caterpillar' as const, total_hours: 1200,
};

describe('maintenance-agent', () => {
  it('happy path returns schedule with evidence_ids', async () => {
    const agent = createMaintenanceAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.next_service_interval_hours).toBe(250);
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createMaintenanceAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('oem_lookup_fail'); } };
    const agent = createMaintenanceAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/oem_lookup_fail/);
  });
});
