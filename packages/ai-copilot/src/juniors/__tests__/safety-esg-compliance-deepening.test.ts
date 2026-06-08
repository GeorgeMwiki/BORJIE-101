/**
 * Tests for the deepened Licence-to-Operate juniors:
 *   - Safety / EHS: deterministic injury-frequency (TRIFR/LTIFR/fatality
 *     rate per million hours) + ICMM Critical Control Management (CCM)
 *     field-verification verdict.
 *   - Compliance / ESG: deterministic voluntary-standard register (ICMM
 *     PE conformance), GISTM tailings-role gate (HIGH-risk inviolable
 *     surface), double-materiality disclosure-pack assembly, assurance-
 *     cycle scheduling, and IAS 37 closure financial assurance.
 *
 * The math modules are tested as pure functions; the agents are tested
 * for the junior contract (evidence gate, deterministic-override
 * authority, un-buffered alerting, error propagation) with a mocked
 * Claude client.
 */

import { describe, it, expect } from 'vitest';
import type { ClaudeClient } from '../_shared.js';
import {
  assessCriticalControls,
  computeFrequencyRates,
  verifyCriticalControl,
  FREQUENCY_BASE_HOURS,
  type CriticalControlRecord,
} from '../safety-hse-metrics.js';
import {
  assembleDisclosurePack,
  checkFinancialAssurance,
  gateTailingsRoles,
  scheduleAssuranceCycle,
  scoreIcmmRegister,
  DISCLOSURE_COMPONENTS,
  TRIENNIAL_DAYS,
} from '../esg-disclosure.js';
import { createSafetyAgent } from '../safety-agent.js';
import { createEsgDisclosureAgent } from '../compliance-agent.js';

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const ZERO_INJ = {
  first_aid: 0,
  medical_treatment: 0,
  restricted_work: 0,
  lost_time_injury: 0,
  fatality: 0,
  near_miss: 0,
};

// ─────────────────────────────────────────────────────────────────────
// Injury-frequency math (pure deterministic)
// ─────────────────────────────────────────────────────────────────────

describe('computeFrequencyRates', () => {
  it('computes TRIFR/LTIFR per million hours from recordable + lost-time counts', () => {
    // 2 medical + 1 restricted + 1 LTI = 4 recordable; LTI=1 lost-time.
    const r = computeFrequencyRates({
      injuries: { ...ZERO_INJ, medical_treatment: 2, restricted_work: 1, lost_time_injury: 1, first_aid: 5, near_miss: 9 },
      hours_worked: 1_000_000,
    });
    expect(r.recordable_count).toBe(4); // first_aid + near_miss NOT recordable
    expect(r.lost_time_count).toBe(1);
    expect(r.trifr).toBe(4); // 4 * 1e6 / 1e6
    expect(r.ltifr).toBe(1);
    expect(r.fatality_rate).toBe(0);
    expect(r.fatality_free).toBe(true);
  });

  it('counts a fatality as both recordable and lost-time and trips fatality_free', () => {
    const r = computeFrequencyRates({
      injuries: { ...ZERO_INJ, fatality: 1 },
      hours_worked: 500_000,
    });
    expect(r.recordable_count).toBe(1);
    expect(r.lost_time_count).toBe(1);
    expect(r.fatality_count).toBe(1);
    expect(r.fatality_rate).toBe(2); // 1 * 1e6 / 5e5
    expect(r.fatality_free).toBe(false);
  });

  it('returns zero rates (not NaN) when no hours are recorded', () => {
    const r = computeFrequencyRates({ injuries: { ...ZERO_INJ, medical_treatment: 3 }, hours_worked: 0 });
    expect(r.trifr).toBe(0);
    expect(Number.isNaN(r.trifr)).toBe(false);
  });

  it('derives trend direction (lower is better) from prior period', () => {
    const improving = computeFrequencyRates({
      injuries: { ...ZERO_INJ, medical_treatment: 1 },
      hours_worked: FREQUENCY_BASE_HOURS,
      prior_trifr: 5,
    });
    expect(improving.trifr).toBe(1);
    expect(improving.trifr_trend).toBe('improving'); // 1 < 5

    const worsening = computeFrequencyRates({
      injuries: { ...ZERO_INJ, medical_treatment: 8 },
      hours_worked: FREQUENCY_BASE_HOURS,
      prior_trifr: 5,
    });
    expect(worsening.trifr_trend).toBe('worsening');
  });

  it('reports no_baseline when no prior period is supplied', () => {
    const r = computeFrequencyRates({ injuries: { ...ZERO_INJ, medical_treatment: 1 }, hours_worked: 1_000_000 });
    expect(r.trifr_trend).toBe('no_baseline');
  });
});

// ─────────────────────────────────────────────────────────────────────
// ICMM Critical Control verification (pure deterministic)
// ─────────────────────────────────────────────────────────────────────

describe('verifyCriticalControl', () => {
  const base: CriticalControlRecord = {
    control_id: 'cc1',
    control: 'Berm height on haul road',
    mue: 'vehicle_over_edge',
    owner: 'Site Manager',
    verification_interval_days: 30,
  };

  it('grades a passed, in-date control as effective', () => {
    const v = verifyCriticalControl({ ...base, days_since_last_verification: 10, last_verification_passed: true });
    expect(v.status).toBe('effective');
    expect(v.overdue).toBe(false);
    expect(v.owner_assigned).toBe(true);
  });

  it('grades a failed last verification as failed regardless of date', () => {
    const v = verifyCriticalControl({ ...base, days_since_last_verification: 1, last_verification_passed: false });
    expect(v.status).toBe('failed');
  });

  it('grades a never-verified control as unverified (cannot assert effectiveness)', () => {
    const v = verifyCriticalControl({ ...base });
    expect(v.status).toBe('unverified');
  });

  it('decays an overdue verification to degraded', () => {
    const v = verifyCriticalControl({ ...base, days_since_last_verification: 45, last_verification_passed: true });
    expect(v.status).toBe('degraded');
    expect(v.overdue).toBe(true);
  });

  it('flags an unowned control as an ICMM CCM violation in the reason', () => {
    const v = verifyCriticalControl({ control_id: 'cc2', control: 'Gas detection', mue: 'asphyxiation', verification_interval_days: 7, days_since_last_verification: 1, last_verification_passed: true });
    expect(v.owner_assigned).toBe(false);
    expect(v.reason).toMatch(/NO named owner/i);
  });
});

describe('assessCriticalControls', () => {
  it('surfaces failed, overdue, unowned controls and exposed MUEs', () => {
    const a = assessCriticalControls([
      { control_id: 'a', control: 'Berm', mue: 'over_edge', owner: 'SM', verification_interval_days: 30, days_since_last_verification: 5, last_verification_passed: true },
      { control_id: 'b', control: 'Brakes', mue: 'over_edge', owner: 'SM', verification_interval_days: 30, days_since_last_verification: 5, last_verification_passed: false },
      { control_id: 'c', control: 'Gas', mue: 'asphyxiation', verification_interval_days: 7, days_since_last_verification: 99, last_verification_passed: false },
    ]);
    expect(a.total).toBe(3);
    expect(a.effective).toBe(1);
    expect(a.failed_control_ids).toEqual(['b', 'c']);
    expect(a.overdue_control_ids).toContain('c');
    expect(a.unowned_control_ids).toEqual(['c']);
    // over_edge has one effective control (a) → not exposed.
    // asphyxiation only has failed control (c) → exposed.
    expect(a.exposed_mues).toEqual(['asphyxiation']);
    expect(a.any_failed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// ICMM PE register scoring (pure deterministic)
// ─────────────────────────────────────────────────────────────────────

describe('scoreIcmmRegister', () => {
  it('scores conformance % over APPLICABLE PEs (NA drops out of the denominator)', () => {
    const r = scoreIcmmRegister([
      { principle: 1, pe_id: 'pe1', outcome: 'meets' },
      { principle: 2, pe_id: 'pe2', outcome: 'meets' },
      { principle: 3, pe_id: 'pe3', outcome: 'partially_meets' },
      { principle: 4, pe_id: 'pe4', outcome: 'does_not_meet' },
      { principle: 5, pe_id: 'pe5', outcome: 'not_applicable' },
    ]);
    expect(r.applicable).toBe(4); // NA excluded
    expect(r.meets).toBe(2);
    expect(r.conformance_pct).toBe(50); // 2/4
    expect(r.gap_pe_ids).toEqual(['pe3', 'pe4']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// GISTM tailings-role gate (HIGH-risk inviolable surface)
// ─────────────────────────────────────────────────────────────────────

describe('gateTailingsRoles', () => {
  it('trips the inviolable breach for an Extreme TSF missing the ITRB', () => {
    const g = gateTailingsRoles({
      facility_id: 'tsf1',
      consequence_class: 'extreme',
      accountable_executive: 'CEO',
      engineer_of_record: 'EoR Ltd',
      rtfe: 'RTFE',
      itrb_in_place: false,
      principle15_disclosure_published: true,
    });
    expect(g.itrb_required).toBe(true);
    expect(g.missing_roles).toContain('itrb');
    expect(g.conformant).toBe(false);
    expect(g.inviolable_breach).toBe(true);
  });

  it('passes a fully-staffed Extreme TSF with ITRB + named roles', () => {
    const g = gateTailingsRoles({
      facility_id: 'tsf2',
      consequence_class: 'very_high',
      accountable_executive: 'CEO',
      engineer_of_record: 'EoR',
      rtfe: 'RTFE',
      itrb_in_place: true,
      principle15_disclosure_published: true,
    });
    expect(g.conformant).toBe(true);
    expect(g.inviolable_breach).toBe(false);
  });

  it('a Low-class facility needs senior independent review, not a full ITRB, and does not trip the inviolable', () => {
    const g = gateTailingsRoles({
      facility_id: 'tsf3',
      consequence_class: 'low',
      accountable_executive: 'AE',
      engineer_of_record: 'EoR',
      rtfe: 'RTFE',
      itrb_in_place: false, // no senior independent review either
      principle15_disclosure_published: true,
    });
    expect(g.itrb_required).toBe(false);
    expect(g.missing_roles).toContain('senior_independent_review');
    expect(g.inviolable_breach).toBe(false); // low class never trips the Extreme/VH inviolable
  });
});

// ─────────────────────────────────────────────────────────────────────
// Disclosure-pack assembly (double-materiality, evidence-required)
// ─────────────────────────────────────────────────────────────────────

describe('assembleDisclosurePack', () => {
  it('marks a component ready only with >=1 evidence_id and gates publishability', () => {
    const p = assembleDisclosurePack({
      standard: 'EITI',
      provided: [
        { component: 'beneficial_ownership', evidence_ids: ['bo_reg_1'] },
        { component: 'contract_disclosure', evidence_ids: [] }, // empty → not ready
        { component: 'payments_to_government', evidence_ids: ['pay_recon_1', 'pay_recon_2'] },
      ],
    });
    expect(p.required_components).toEqual(DISCLOSURE_COMPONENTS.EITI);
    expect(p.ready_components).toEqual(['beneficial_ownership', 'payments_to_government']);
    expect(p.missing_components).toContain('contract_disclosure');
    expect(p.missing_components).toContain('production_export');
    expect(p.publishable).toBe(false);
    expect(p.evidence_chain).toEqual(['bo_reg_1', 'pay_recon_1', 'pay_recon_2']);
  });

  it('is publishable when every required component carries evidence', () => {
    const provided = DISCLOSURE_COMPONENTS.CLOSURE_IAS37.map((c) => ({ component: c, evidence_ids: [`ev_${c}`] }));
    const p = assembleDisclosurePack({ standard: 'CLOSURE_IAS37', provided });
    expect(p.readiness_pct).toBe(100);
    expect(p.publishable).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Assurance-cycle scheduling + closure financial assurance
// ─────────────────────────────────────────────────────────────────────

describe('scheduleAssuranceCycle', () => {
  it('uses the triennial cadence by default and flags overdue', () => {
    const s = scheduleAssuranceCycle({ standard: 'ICMM', days_since_last: TRIENNIAL_DAYS + 10 });
    expect(s.cadence_days).toBe(TRIENNIAL_DAYS);
    expect(s.days_until_due).toBe(-10);
    expect(s.overdue).toBe(true);
  });

  it('treats a never-validated standard as overdue', () => {
    const s = scheduleAssuranceCycle({ standard: 'TSM' });
    expect(s.never_validated).toBe(true);
    expect(s.overdue).toBe(true);
  });
});

describe('checkFinancialAssurance', () => {
  it('flags an inviolable breach on a closure-assurance shortfall', () => {
    const r = checkFinancialAssurance({ closure_cost_estimate: 1000, assurance_instrument_value: 600, currency_code: 'TZS' });
    expect(r.shortfall).toBe(400);
    expect(r.coverage_pct).toBe(60);
    expect(r.assurance_present).toBe(true);
    expect(r.inviolable_breach).toBe(true);
    expect(r.currency_code).toBe('TZS'); // never hard-coded
  });

  it('flags an inviolable breach when no assurance is posted at all', () => {
    const r = checkFinancialAssurance({ closure_cost_estimate: 1000, assurance_instrument_value: 0, currency_code: 'USD' });
    expect(r.assurance_present).toBe(false);
    expect(r.inviolable_breach).toBe(true);
  });

  it('passes when the instrument fully covers the closure cost', () => {
    const r = checkFinancialAssurance({ closure_cost_estimate: 1000, assurance_instrument_value: 1200, currency_code: 'KES' });
    expect(r.shortfall).toBe(0);
    expect(r.inviolable_breach).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Safety agent — junior contract + deterministic override + alerting
// ─────────────────────────────────────────────────────────────────────

const SAFETY_VALID = {
  site_id: 's1',
  frequency_rates: null,
  critical_controls: [{ control: 'Berm', status: 'effective' }],
  exposed_mues: [],
  incident_heatmap: [{ site_section: 'pit', severity_score: 3, count: 1 }],
  ppe_compliance_pct: 92,
  immediate_alerts: [],
  required_actions: [],
  confidence: 0.9,
  rationale: 'baseline safety review',
  evidence_ids: ['incident_log_1'],
  citations: [],
};

describe('safety-agent (deepened)', () => {
  it('computes deterministic TRIFR/LTIFR and overrides any LLM echo', async () => {
    // LLM claims a bogus frequency block; agent must overwrite it.
    const lying = {
      ...SAFETY_VALID,
      frequency_rates: {
        hours_worked: 999, recordable_count: 0, lost_time_count: 0, fatality_count: 0,
        trifr: 0, ltifr: 0, fatality_rate: 0, trifr_trend: 'flat', ltifr_trend: 'flat', fatality_free: true,
      },
    };
    const agent = createSafetyAgent({ claude: claudeOf(lying) });
    const out = await agent.processInput({
      tenantId: 't1',
      siteId: 's1',
      hours_worked: 1_000_000,
      recent_incidents: [
        { incident_id: 'i1', iso_ts: '2026-01-01', kind: 'medical_treatment', severity: 'medium', site_id: 's1', description: 'cut' },
        { incident_id: 'i2', iso_ts: '2026-01-02', kind: 'lost_time_injury', severity: 'high', site_id: 's1', description: 'fall' },
      ],
    });
    expect(out.frequency_rates?.trifr).toBe(2); // deterministic, not 0
    expect(out.frequency_rates?.ltifr).toBe(1);
    expect(out.frequency_rates?.hours_worked).toBe(1_000_000);
  });

  it('raises an un-buffered fatality alert (ICMM Principle 5 hard constraint)', async () => {
    const agent = createSafetyAgent({ claude: claudeOf(SAFETY_VALID) });
    const out = await agent.processInput({
      tenantId: 't1',
      siteId: 's1',
      hours_worked: 500_000,
      recent_incidents: [
        { incident_id: 'i9', iso_ts: '2026-01-03', kind: 'fatality', severity: 'critical', site_id: 's1', description: 'rockfall' },
      ],
    });
    expect(out.frequency_rates?.fatality_free).toBe(false);
    expect(out.immediate_alerts.some((a) => /FATALITY/i.test(a))).toBe(true);
  });

  it('verifies critical controls deterministically and alerts on a failed control', async () => {
    const agent = createSafetyAgent({ claude: claudeOf(SAFETY_VALID) });
    const out = await agent.processInput({
      tenantId: 't1',
      siteId: 's1',
      critical_controls: [
        { control_id: 'cc1', control: 'Gas detection', mue: 'asphyxiation', owner: 'SM', verification_interval_days: 7, days_since_last_verification: 2, last_verification_passed: false },
      ],
    });
    expect(out.critical_controls[0]?.status).toBe('failed');
    expect(out.exposed_mues).toContain('asphyxiation');
    expect(out.immediate_alerts.some((a) => /FAILED|asphyxiation/i.test(a))).toBe(true);
  });

  it('leaves frequency_rates null when no hours and no incidents are supplied', async () => {
    const agent = createSafetyAgent({ claude: claudeOf(SAFETY_VALID) });
    const out = await agent.processInput({ tenantId: 't1', siteId: 's1' });
    expect(out.frequency_rates).toBeNull();
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createSafetyAgent({ claude: claudeOf({ ...SAFETY_VALID, evidence_ids: [] }) });
    await expect(agent.processInput({ tenantId: 't1', siteId: 's1' })).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('safety_feed_down'); } };
    const agent = createSafetyAgent({ claude });
    await expect(agent.processInput({ tenantId: 't1', siteId: 's1' })).rejects.toThrow(/safety_feed_down/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// ESG / disclosure agent — junior contract + deterministic override
// ─────────────────────────────────────────────────────────────────────

const ESG_VALID = {
  asset_id: 'mine1',
  irma_level: 'none',
  icmm: null,
  tailings_gates: [],
  disclosure_packs: [],
  assurance_schedule: [],
  financial_assurance: null,
  inviolable_breaches: [],
  immediate_alerts: [],
  confidence: 0.9,
  rationale: 'ESG register assembly',
  evidence_ids: ['icmm_pe_self_assessment_1'],
  citations: [],
};

describe('esg-disclosure-agent (deepened)', () => {
  it('computes deterministic ICMM conformance + GISTM gate and surfaces the inviolable breach', async () => {
    // LLM lies that everything is fine; agent must overwrite with truth.
    const lying = {
      ...ESG_VALID,
      icmm: { applicable: 99, meets: 99, partially_meets: 0, does_not_meet: 0, conformance_pct: 100, gap_pe_ids: [] },
      inviolable_breaches: [],
    };
    const agent = createEsgDisclosureAgent({ claude: claudeOf(lying) });
    const out = await agent.processInput({
      tenantId: 't1',
      asset_id: 'mine1',
      irma_level: '75',
      icmm_register: [
        { principle: 1, pe_id: 'pe1', outcome: 'meets' },
        { principle: 2, pe_id: 'pe2', outcome: 'does_not_meet' },
      ],
      tailings_facilities: [
        { facility_id: 'tsf1', consequence_class: 'extreme', accountable_executive: 'CEO', engineer_of_record: 'EoR', rtfe: 'RTFE', itrb_in_place: false, principle15_disclosure_published: true },
      ],
    });
    expect(out.icmm?.conformance_pct).toBe(50); // deterministic, not 100
    expect(out.icmm?.gap_pe_ids).toEqual(['pe2']);
    expect(out.tailings_gates[0]?.inviolable_breach).toBe(true);
    expect(out.inviolable_breaches.some((b) => /TSF tsf1/.test(b))).toBe(true);
    expect(out.immediate_alerts.length).toBeGreaterThan(0);
    expect(out.irma_level).toBe('75');
  });

  it('assembles a disclosure pack with deterministic readiness and evidence chain', async () => {
    const agent = createEsgDisclosureAgent({ claude: claudeOf(ESG_VALID) });
    const out = await agent.processInput({
      tenantId: 't1',
      asset_id: 'mine1',
      disclosure_requests: [
        { standard: 'EITI', provided: [{ component: 'beneficial_ownership', evidence_ids: ['bo1'] }] },
      ],
    });
    expect(out.disclosure_packs[0]?.standard).toBe('EITI');
    expect(out.disclosure_packs[0]?.ready_components).toEqual(['beneficial_ownership']);
    expect(out.disclosure_packs[0]?.publishable).toBe(false);
    expect(out.disclosure_packs[0]?.evidence_chain).toContain('bo1');
  });

  it('flags the closure financial-assurance inviolable breach (never hard-coding currency)', async () => {
    const agent = createEsgDisclosureAgent({ claude: claudeOf(ESG_VALID) });
    const out = await agent.processInput({
      tenantId: 't1',
      asset_id: 'mine1',
      financial_assurance: { closure_cost_estimate: 1000, assurance_instrument_value: 0, currency_code: 'TZS' },
    });
    expect(out.financial_assurance?.inviolable_breach).toBe(true);
    expect(out.financial_assurance?.currency_code).toBe('TZS');
    expect(out.inviolable_breaches.some((b) => /financial assurance/i.test(b))).toBe(true);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createEsgDisclosureAgent({ claude: claudeOf({ ...ESG_VALID, evidence_ids: [] }) });
    await expect(agent.processInput({ tenantId: 't1', asset_id: 'mine1' })).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('esg_feed_down'); } };
    const agent = createEsgDisclosureAgent({ claude });
    await expect(agent.processInput({ tenantId: 't1', asset_id: 'mine1' })).rejects.toThrow(/esg_feed_down/);
  });
});
