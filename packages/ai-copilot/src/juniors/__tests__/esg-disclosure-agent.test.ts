import { describe, it, expect } from 'vitest';
import {
  createEsgDisclosureAgent,
  assembleFrameworkReadiness,
  collectInviolableFlags,
  type EsgDisclosureInput,
} from '../esg-disclosure-agent.js';
import type { ClaudeClient } from '../_shared.js';

// LLM stub — narrative only; deterministic scores are authoritative.
function claudeNarrative(): ClaudeClient {
  return {
    async complete() {
      return {
        content: JSON.stringify({
          asset_id: 'a1',
          period: 'FY2026',
          frameworks: [],
          overall_readiness_pct: 0,
          overall_band: 'not_started',
          inviolable_flags: [],
          disclosure_pack: 'LLM narrative pack.',
          required_actions: ['Engage VSP for ICMM validation.'],
          confidence: 0.9,
          rationale: 'narrative ok',
          evidence_ids: ['n1'],
          citations: ['ICMM §1.1'],
        }),
      };
    },
  };
}

const FULL: EsgDisclosureInput = {
  tenantId: 't1',
  assetId: 'a1',
  period: 'FY2026',
  audience: 'lender',
  icmm_pes: [
    { principle: 5, pe_id: 'PE5.1', outcome: 'meets', self_assessed_iso: '2026-01-01', third_party_validated: true, evidence_id: 'ev_icmm_1' },
    { principle: 7, pe_id: 'PE7.1', outcome: 'partially_meets', self_assessed_iso: '2026-01-01', third_party_validated: false, evidence_id: 'ev_icmm_2' },
  ],
  irma: { level_claimed: 'irma_75', requirements_met: 320, requirements_total: 400, critical_requirements_met: true, evidence_id: 'ev_irma' },
  tailings_facilities: [
    { facility_id: 'tsf1', consequence_class: 'extreme', accountable_executive: 'CEO', engineer_of_record: 'EoR Ltd', responsible_tailings_facility_engineer: 'RTFE', itrb_appointed: true, p15_disclosure_published: true, evidence_id: 'ev_tsf1' },
  ],
  issb: { governance_disclosed: true, strategy_scenario_analysis: true, risk_management_disclosed: true, metrics_targets_disclosed: true, scope1_tco2e: 1000, scope2_tco2e: 500, scope3_tco2e: 50000, scope3_categories_disclosed: 15, evidence_id: 'ev_issb' },
  eiti: { beneficial_ownership_disclosed: true, contracts_disclosed: true, payments_to_government_reconciled: true, evidence_id: 'ev_eiti' },
  closure: { closure_plan_present: true, ias37_provision_booked: true, financial_assurance_present: true, evidence_id: 'ev_closure' },
};

describe('esg-disclosure deterministic conformance engine', () => {
  it('scores a fully-conformant register near 100%', () => {
    const fw = assembleFrameworkReadiness(FULL);
    const eiti = fw.find((f) => f.framework === 'EITI');
    const gistm = fw.find((f) => f.framework === 'GISTM');
    const closure = fw.find((f) => f.framework === 'CLOSURE');
    const issb = fw.find((f) => f.framework === 'ISSB');
    expect(eiti?.score_pct).toBe(100);
    expect(gistm?.score_pct).toBe(100);
    expect(closure?.score_pct).toBe(100);
    expect(issb?.score_pct).toBe(100);
  });

  it('caps un-validated ICMM PE conformance below full credit', () => {
    const fw = assembleFrameworkReadiness({
      ...FULL,
      icmm_pes: [
        { principle: 1, pe_id: 'PE1', outcome: 'meets', self_assessed_iso: '2026-01-01', third_party_validated: false, evidence_id: 'e1' },
      ],
    });
    const icmm = fw.find((f) => f.framework === 'ICMM');
    // meets but not VSP-validated → 0.8 base → 80%
    expect(icmm?.score_pct).toBe(80);
    expect(icmm?.gaps.some((g) => g.includes('not VSP-validated'))).toBe(true);
  });

  it('treats NA ICMM PEs as excluded from the denominator', () => {
    const fw = assembleFrameworkReadiness({
      ...FULL,
      icmm_pes: [
        { principle: 1, pe_id: 'PE1', outcome: 'meets', self_assessed_iso: null, third_party_validated: true, evidence_id: 'e1' },
        { principle: 2, pe_id: 'PE2', outcome: 'not_applicable', self_assessed_iso: null, third_party_validated: false },
      ],
    });
    const icmm = fw.find((f) => f.framework === 'ICMM');
    expect(icmm?.score_pct).toBe(100);
  });

  it('caps IRMA below substantial when critical requirements are not met', () => {
    const fw = assembleFrameworkReadiness({
      ...FULL,
      irma: { level_claimed: 'irma_75', requirements_met: 390, requirements_total: 400, critical_requirements_met: false, evidence_id: 'ev' },
    });
    const irma = fw.find((f) => f.framework === 'IRMA');
    expect(irma?.score_pct).toBeLessThanOrEqual(49);
    expect(irma?.gaps.some((g) => g.includes('Critical requirements NOT all met'))).toBe(true);
  });

  it('scores GISTM down when an Extreme TSF lacks an ITRB', () => {
    const fw = assembleFrameworkReadiness({
      ...FULL,
      tailings_facilities: [
        { facility_id: 'tsf1', consequence_class: 'extreme', accountable_executive: 'CEO', engineer_of_record: 'EoR', responsible_tailings_facility_engineer: 'RTFE', itrb_appointed: false, p15_disclosure_published: true, evidence_id: 'ev' },
      ],
    });
    const gistm = fw.find((f) => f.framework === 'GISTM');
    expect(gistm?.score_pct).toBeLessThan(100);
    expect(gistm?.gaps.some((g) => g.includes('missing ITRB'))).toBe(true);
  });

  it('treats ISSB Scope-3 partial-category coverage as a gap', () => {
    const fw = assembleFrameworkReadiness({
      ...FULL,
      issb: { governance_disclosed: true, strategy_scenario_analysis: true, risk_management_disclosed: true, metrics_targets_disclosed: true, scope1_tco2e: 1, scope2_tco2e: 1, scope3_tco2e: 1, scope3_categories_disclosed: 5, evidence_id: 'ev' },
    });
    const issb = fw.find((f) => f.framework === 'ISSB');
    expect(issb?.score_pct).toBeLessThan(100);
    expect(issb?.gaps.some((g) => g.includes('5/15'))).toBe(true);
  });
});

describe('esg-disclosure inviolable flags (kernel-prefix mapping)', () => {
  it('raises a kill_switch flag for an Extreme TSF missing ITRB/EoR/AE', () => {
    const flags = collectInviolableFlags({
      ...FULL,
      tailings_facilities: [
        { facility_id: 'tsf1', consequence_class: 'extreme', accountable_executive: null, engineer_of_record: null, responsible_tailings_facility_engineer: null, itrb_appointed: false, p15_disclosure_published: false, evidence_id: 'ev_tsf' },
      ],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]?.policy_prefix).toBe('kill_switch');
    expect(flags[0]?.rule).toBe('no_extreme_tsf_without_itrb_eor_accountable_executive');
    expect(flags[0]?.evidence_id).toBe('ev_tsf');
  });

  it('raises a four_eye flag when closure financial assurance is absent', () => {
    const flags = collectInviolableFlags({
      ...FULL,
      tailings_facilities: [],
      closure: { closure_plan_present: true, ias37_provision_booked: true, financial_assurance_present: false, evidence_id: 'ev_closure' },
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]?.policy_prefix).toBe('four_eye');
    expect(flags[0]?.rule).toBe('closure_financial_assurance_always_present');
  });

  it('raises no flags for a fully-conformant register', () => {
    expect(collectInviolableFlags(FULL)).toHaveLength(0);
  });
});

describe('esg-disclosure-agent factory', () => {
  it('assembles a disclosure pack with deterministic frameworks + non-empty evidence', async () => {
    const agent = createEsgDisclosureAgent({ claude: claudeNarrative() });
    const out = await agent.processInput(FULL);
    expect(out.frameworks).toHaveLength(6);
    expect(out.overall_readiness_pct).toBeGreaterThan(0);
    expect(out.disclosure_pack.length).toBeGreaterThan(0);
    expect(out.evidence_ids.length).toBeGreaterThan(0);
    expect(out.evidence_ids).toContain('ev_eiti');
    expect(out.inviolable_flags).toHaveLength(0);
  });

  it('surfaces inviolable flags + falls back to deterministic pack on LLM failure', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('issb_lookup_fail'); } };
    const agent = createEsgDisclosureAgent({ claude });
    const out = await agent.processInput({
      ...FULL,
      tailings_facilities: [
        { facility_id: 'tsf1', consequence_class: 'extreme', accountable_executive: null, engineer_of_record: null, responsible_tailings_facility_engineer: null, itrb_appointed: false, p15_disclosure_published: false, evidence_id: 'ev_tsf' },
      ],
      closure: { closure_plan_present: false, ias37_provision_booked: false, financial_assurance_present: false, evidence_id: 'ev_closure' },
    });
    expect(out.inviolable_flags.map((f) => f.policy_prefix)).toContain('kill_switch');
    expect(out.inviolable_flags.map((f) => f.policy_prefix)).toContain('four_eye');
    // deterministic pack shipped despite LLM failure
    expect(out.disclosure_pack).toMatch(/readiness/);
    expect(out.required_actions.some((a) => a.includes('INVIOLABLE'))).toBe(true);
  });

  it('never produces an empty evidence chain (Auditor base)', async () => {
    const agent = createEsgDisclosureAgent({ claude: claudeNarrative() });
    const out = await agent.processInput({
      tenantId: 't1',
      assetId: 'bare',
      period: 'FY2026',
    });
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });
});
