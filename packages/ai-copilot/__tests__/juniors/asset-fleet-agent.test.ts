import { describe, it, expect } from 'vitest';
import { createAssetFleetAgent } from '../../src/juniors/asset-fleet-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  fleet_health: 'green',
  utilisation_pct: 78,
  service_due_now: [],
  service_due_in_7d: ['EX-001'],
  predictive_maintenance_alerts: [],
  rent_vs_buy_pending: [],
  recommendations: ['rotate truck T-12'],
  confidence: 0.82,
  rationale: 'fleet healthy',
  evidence_ids: ['fl_1'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1',
  assets: [
    {
      asset_id: 'EX-001', kind: 'excavator' as const, ownership: 'owned' as const,
      hours_used_total: 1200, hours_since_last_service: 200, next_service_at_hours: 250,
    },
  ],
};

describe('asset-fleet-agent', () => {
  it('happy path returns valid shape with evidence_ids', async () => {
    const agent = createAssetFleetAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.fleet_health).toBe('green');
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createAssetFleetAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('upstream_503'); } };
    const agent = createAssetFleetAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/upstream_503/);
  });
});
