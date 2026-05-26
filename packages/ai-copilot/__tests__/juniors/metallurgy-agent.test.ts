import { describe, it, expect } from 'vitest';
import { createMetallurgyAgent } from '../../src/juniors/metallurgy-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  recommended_flowsheet: ['crushing', 'gravity'],
  expected_recovery_pct: 70,
  capex_band_tzs: { low: 1_000_000, mid: 5_000_000, high: 10_000_000 },
  opex_per_tonne_tzs: 25_000,
  mercury_free_alternatives: ['borax_smelt'],
  cyanide_required: false,
  cyanide_management_notes: null,
  by_product_recovery_opportunities: [],
  confidence: 0.78,
  rationale: 'ASM gold gravity + borax',
  evidence_ids: ['mineral_dossier_au'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', siteId: 's1', mineral_family: 'gold' as const,
  head_grade_g_per_t_or_pct: 4.5,
};

describe('metallurgy-agent', () => {
  it('happy path returns flowsheet with evidence_ids', async () => {
    const agent = createMetallurgyAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.recommended_flowsheet[0]).toBe('crushing');
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createMetallurgyAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('recovery_sim_fail'); } };
    const agent = createMetallurgyAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/recovery_sim_fail/);
  });
});
