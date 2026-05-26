import { describe, it, expect } from 'vitest';
import { createForecastModeler } from '../../src/juniors/forecast-modeler.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  kind: 'production',
  horizon_days: 30,
  formula: 'linear regression on 7-day history',
  series_by_scenario: [
    { scenario: 'best', points: [{ date: '2026-04-01', value: 110 }], cumulative: 3300 },
    { scenario: 'base', points: [{ date: '2026-04-01', value: 100 }], cumulative: 3000 },
    { scenario: 'worst', points: [{ date: '2026-04-01', value: 90 }], cumulative: 2700 },
  ],
  inputs_used: ['historical_series'],
  caveats: [],
  confidence: 0.75,
  rationale: 'modest extrapolation',
  evidence_ids: ['hs_2026_03_28'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', kind: 'production' as const, horizon_days: 30 as const,
  historical_series: [
    { date: '2026-03-22', value: 95 }, { date: '2026-03-23', value: 96 },
    { date: '2026-03-24', value: 98 }, { date: '2026-03-25', value: 99 },
    { date: '2026-03-26', value: 100 }, { date: '2026-03-27', value: 101 },
    { date: '2026-03-28', value: 102 },
  ],
};

describe('forecast-modeler', () => {
  it('happy path returns scenario series with evidence_ids', async () => {
    const agent = createForecastModeler({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.series_by_scenario.length).toBe(3);
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createForecastModeler({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('mc_sim_fail'); } };
    const agent = createForecastModeler({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/mc_sim_fail/);
  });
});
