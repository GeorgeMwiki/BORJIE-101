import { describe, it, expect } from 'vitest';
import { createStructuralCivilAgent } from '../structural-civil-agent.js';
import type { ClaudeClient } from '../_shared.js';

const STRUCTURAL_NARRATION = {
  element_id: 'IGNORED',
  design_code: 'aci318',
  limit_state: {
    design_action: 0,
    uls_utilisation: 0,
    uls_pass: true,
    sls_utilisation: 0,
    sls_pass: true,
    verdict: 'pass',
  },
  eor_review_required: false,
  engineer_commentary: 'Member governed by ULS bending.',
  confidence: 0.85,
  rationale: 'Limit-state triage over verified EN 1990 figures.',
  evidence_ids: ['construction-built-environment.md#section-6'],
  citations: ['EN 1990'],
};

const TSF_NARRATION = {
  facility_id: 'IGNORED',
  consequence_class: 'low',
  required_roles: [],
  itrb_required: false,
  missing_roles: [],
  surveillance_band: 'green',
  verdict: 'conformant',
  upstream_method_flag: false,
  tsf_commentary: 'Facility within design envelope.',
  confidence: 0.9,
  rationale: 'GISTM surveillance over verified engine output.',
  evidence_ids: ['construction-built-environment.md#section-7'],
  citations: ['GISTM Topic IV'],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

describe('structural-civil-agent — §6 limit-state sanity', () => {
  it('overrides the LLM with the deterministic Eurocode verdict', async () => {
    const agent = createStructuralCivilAgent({ claude: claudeOf(STRUCTURAL_NARRATION) });
    const out = await agent.processInput({
      tenantId: 't1',
      projectId: 'plant-1',
      element_id: 'B-12',
      element_type: 'beam',
      design_code: 'eurocode',
      permanent_action: 100,
      variable_action: 50, // demand 210
      design_resistance: 215, // util 0.977 → marginal
      sls_deflection_mm: 1,
      sls_deflection_limit_mm: 20,
    });
    expect(out.element_id).toBe('B-12');
    expect(out.design_code).toBe('eurocode');
    expect(out.limit_state.verdict).toBe('marginal');
    expect(out.limit_state.design_action).toBe(210);
    expect(out.eor_review_required).toBe(true); // marginal must route to EoR
  });

  it('routes a failed ULS to the Engineer of Record', async () => {
    const agent = createStructuralCivilAgent({ claude: claudeOf(STRUCTURAL_NARRATION) });
    const out = await agent.processInput({
      tenantId: 't1',
      projectId: 'plant-1',
      element_id: 'C-3',
      element_type: 'column',
      design_code: 'aci318',
      permanent_action: 200,
      variable_action: 100, // demand 400
      design_resistance: 300, // > 1 → fail
      sls_deflection_mm: 1,
      sls_deflection_limit_mm: 20,
    });
    expect(out.limit_state.uls_pass).toBe(false);
    expect(out.limit_state.verdict).toBe('fail');
    expect(out.eor_review_required).toBe(true);
  });
});

describe('structural-civil-agent — §7 GISTM TSF gate (fail-closed inviolable)', () => {
  it('BLOCKS an Extreme facility missing required Topic-IV roles, regardless of the model', async () => {
    // Model says "conformant" — the deterministic gate must override to blocked.
    const agent = createStructuralCivilAgent({ claude: claudeOf(TSF_NARRATION) });
    const out = await agent.processTsf({
      tenantId: 't1',
      facilityId: 'TSF-1',
      potential_loss_of_life: 270,
      damage_band: 'catastrophic',
      construction_method: 'upstream',
      named_roles: [{ role: 'Accountable Executive', named_person: 'Jane Doe' }], // EoR/RTFE/ITRB missing
      readings: [{ instrument: 'piezometer', id: 'PZ1', value: 1, trigger_level: 10, action_level: 15 }],
    });
    expect(out.consequence_class).toBe('extreme');
    expect(out.itrb_required).toBe(true);
    expect(out.verdict).toBe('blocked');
    expect(out.missing_roles).toContain('Independent Tailings Review Board (ITRB)');
    expect(out.missing_roles).toContain('Engineer of Record (EoR)');
    expect(out.upstream_method_flag).toBe(true);
  });

  it('allows conformant when all Extreme roles are named and surveillance is green', async () => {
    const agent = createStructuralCivilAgent({ claude: claudeOf(TSF_NARRATION) });
    const out = await agent.processTsf({
      tenantId: 't1',
      facilityId: 'TSF-2',
      potential_loss_of_life: 270,
      damage_band: 'catastrophic',
      construction_method: 'downstream',
      named_roles: [
        { role: 'Accountable Executive', named_person: 'A' },
        { role: 'Engineer of Record (EoR)', named_person: 'B' },
        { role: 'Responsible Tailings Facility Engineer (RTFE)', named_person: 'C' },
        { role: 'Independent Tailings Review Board (ITRB)', named_person: 'D' },
      ],
      readings: [{ instrument: 'piezometer', id: 'PZ1', value: 1, trigger_level: 10, action_level: 15 }],
    });
    expect(out.verdict).toBe('conformant');
    expect(out.missing_roles).toHaveLength(0);
  });

  it('escalates on a red surveillance band (action-level exceedance)', async () => {
    const agent = createStructuralCivilAgent({ claude: claudeOf(TSF_NARRATION) });
    const out = await agent.processTsf({
      tenantId: 't1',
      facilityId: 'TSF-3',
      potential_loss_of_life: 0,
      damage_band: 'minor', // low class, no ITRB inviolable
      construction_method: 'centreline',
      named_roles: [],
      readings: [{ instrument: 'inclinometer', id: 'IN1', value: 20, trigger_level: 10, action_level: 15 }],
    });
    expect(out.consequence_class).toBe('low');
    expect(out.surveillance_band).toBe('red');
    expect(out.verdict).toBe('escalate');
  });
});

describe('structural-civil-agent — audit base', () => {
  it('rejects empty evidence_ids from the LLM port', async () => {
    const agent = createStructuralCivilAgent({ claude: claudeOf({ ...STRUCTURAL_NARRATION, evidence_ids: [] }) });
    await expect(
      agent.processInput({
        tenantId: 't1',
        projectId: 'p',
        element_id: 'B-1',
        element_type: 'beam',
        design_code: 'eurocode',
        permanent_action: 1,
        variable_action: 1,
        design_resistance: 100,
        sls_deflection_mm: 1,
        sls_deflection_limit_mm: 10,
      }),
    ).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('limit_state_narration_fail'); } };
    const agent = createStructuralCivilAgent({ claude });
    await expect(
      agent.processInput({
        tenantId: 't1',
        projectId: 'p',
        element_id: 'B-1',
        element_type: 'beam',
        design_code: 'eurocode',
        permanent_action: 1,
        variable_action: 1,
        design_resistance: 100,
        sls_deflection_mm: 1,
        sls_deflection_limit_mm: 10,
      }),
    ).rejects.toThrow(/limit_state_narration_fail/);
  });
});
