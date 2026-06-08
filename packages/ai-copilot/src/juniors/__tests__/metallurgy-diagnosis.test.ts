import { describe, it, expect } from 'vitest';
import {
  createMetallurgyAgent,
  runMetallurgyDiagnosis,
  type MetallurgyInput,
} from '../metallurgy-agent.js';
import {
  assessHeadGrade,
  bondSpecificEnergy,
  diagnoseRecovery,
  diagnoseThroughput,
  getMineralProfile,
  MINERAL_FAMILIES,
  MINERAL_PROFILES,
} from '../metallurgy-knowledge.js';
import type { ClaudeClient } from '../_shared.js';

// A complete, valid LLM payload (deterministic fields are overwritten by
// the agent, so the values here are intentionally "wrong" to prove it).
const LLM_PAYLOAD = {
  recommended_flowsheet: ['crushing', 'gravity', 'cil'],
  expected_recovery_pct: 88,
  capex_band_tzs: { low: 1_000_000, mid: 5_000_000, high: 10_000_000 },
  opex_per_tonne_tzs: 25_000,
  mercury_free_alternatives: ['borax_smelt'],
  cyanide_required: true,
  cyanide_management_notes: 'ICMC aligned',
  by_product_recovery_opportunities: [],
  head_grade_verdict: 'high_grade', // wrong on purpose
  recovery_verdict: 'at_best_practice', // wrong on purpose
  recovery_envelope_pct: { low: 0, high: 0 }, // wrong on purpose
  throughput_diagnosis: null,
  confidence: 0.82,
  rationale: 'gold gravity + CIL',
  evidence_ids: ['llm_dossier_au'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const GOLD_INPUT: MetallurgyInput = {
  tenantId: 't1',
  siteId: 's1',
  mineral_family: 'gold',
  head_grade_g_per_t_or_pct: 4.5,
  budget_constrained: true,
  artisanal_scale: true,
  has_water_source_within_60m: false,
  current_flowsheet: [],
};

describe('metallurgy knowledge base — per-mineral awareness', () => {
  it('covers every supported mineral family with a profile (not gold-only)', () => {
    for (const family of MINERAL_FAMILIES) {
      const profile = getMineralProfile(family);
      expect(profile.family).toBe(family);
      expect(profile.preferredRoutes.length).toBeGreaterThan(0);
      expect(profile.recoveryHighPct).toBeGreaterThan(profile.recoveryLowPct);
      expect(profile.evidenceId.length).toBeGreaterThan(0);
    }
  });

  it('routes by mineral family, not a single gold default', () => {
    expect(MINERAL_PROFILES.tin.preferredRoutes[0]).toBe('gravity');
    expect(MINERAL_PROFILES.copper.preferredRoutes[0]).toBe('flotation');
    expect(MINERAL_PROFILES.iron_ore.preferredRoutes[0]).toBe('magnetic_separation');
    expect(MINERAL_PROFILES.diamond.preferredRoutes[0]).toBe('dms');
    expect(MINERAL_PROFILES.graphite.preferredRoutes[0]).toBe('flotation');
  });

  it('flags only gold as cyanide-relevant and U/REE as NORM', () => {
    expect(MINERAL_PROFILES.gold.cyanideRelevant).toBe(true);
    expect(MINERAL_PROFILES.copper.cyanideRelevant).toBe(false);
    expect(MINERAL_PROFILES.uranium.norm).toBe(true);
    expect(MINERAL_PROFILES.rare_earth.norm).toBe(true);
    expect(MINERAL_PROFILES.gold.norm).toBe(false);
  });
});

describe('head grade vs cut-off (deterministic)', () => {
  it('grades a sub-cutoff feed below_cutoff', () => {
    const a = assessHeadGrade('gold', 0.2);
    expect(a.verdict).toBe('below_cutoff');
    expect(a.grade_unit).toBe('g_per_t');
  });

  it('grades a strong gold feed economic/high_grade', () => {
    expect(assessHeadGrade('gold', 4.5).verdict).toBe('economic');
    expect(assessHeadGrade('gold', 50).verdict).toBe('high_grade');
  });

  it('respects a price-derived effective cut-off override', () => {
    const a = assessHeadGrade('gold', 1.0, 1.5);
    expect(a.cutoff_floor).toBe(1.5);
    expect(a.verdict).toBe('below_cutoff');
  });

  it('uses % units for base metals', () => {
    expect(assessHeadGrade('copper', 0.6).grade_unit).toBe('pct');
  });
});

describe('recovery KPI diagnosis (deterministic)', () => {
  it('flags below-envelope recovery with per-family causes', () => {
    const d = diagnoseRecovery('gold', 40);
    expect(d.verdict).toBe('below_envelope');
    expect(d.gap_to_envelope_pct).toBeLessThan(0);
    expect(d.likely_causes.some((c) => /gravity circuit ahead of CIL/i.test(c))).toBe(true);
  });

  it('reports no_baseline when no observation', () => {
    expect(diagnoseRecovery('copper', null).verdict).toBe('no_baseline');
  });

  it('classifies in-envelope and best-practice', () => {
    expect(diagnoseRecovery('gold', 80).verdict).toBe('in_envelope');
    expect(diagnoseRecovery('gold', 95).verdict).toBe('at_best_practice');
  });

  it('gives copper a copper-specific loss cause, not a gold one', () => {
    const d = diagnoseRecovery('copper', 50);
    expect(d.likely_causes.some((c) => /pyrite/i.test(c))).toBe(true);
    expect(d.likely_causes.some((c) => /CIL/i.test(c))).toBe(false);
  });
});

describe('throughput diagnosis (Bond third law + availability)', () => {
  it('computes Bond specific energy (W = 10·Wi·(1/√P − 1/√F))', () => {
    // Wi=16, F80=10000µm, P80=100µm → 10*16*(0.1-0.01)=14.4
    expect(bondSpecificEnergy(16, 10_000, 100)).toBeCloseTo(14.4, 1);
    expect(bondSpecificEnergy(16, 0, 100)).toBe(0);
  });

  it('derives power-limited capacity and availability haircut', () => {
    const d = diagnoseThroughput({
      family: 'gold',
      installed_mill_kw: 1500,
      feed_f80_um: 10_000,
      product_p80_um: 100,
      observed_tph: 50,
      mtbf_h: 190,
      mttr_h: 10,
    });
    expect(d.specific_energy_kwh_per_t).toBeGreaterThan(0);
    expect(d.power_limited_tph).toBeGreaterThan(0);
    expect(d.availability).toBeCloseTo(0.95, 2);
    expect(d.effective_nameplate_tph).toBeCloseTo(d.power_limited_tph * 0.95, 1);
  });

  it('defaults to 0.95 mill availability when MTBF/MTTR absent', () => {
    const d = diagnoseThroughput({
      family: 'copper',
      installed_mill_kw: 2000,
      feed_f80_um: 8000,
      product_p80_um: 106,
    });
    expect(d.availability).toBe(0.95);
    expect(d.utilisation_vs_nameplate).toBeNull();
    expect(d.verdict).toBe('no_baseline');
  });

  it('blames downtime when availability is low', () => {
    const d = diagnoseThroughput({
      family: 'gold',
      installed_mill_kw: 1500,
      feed_f80_um: 10_000,
      product_p80_um: 100,
      observed_tph: 30,
      mtbf_h: 100,
      mttr_h: 40,
    });
    expect(d.availability).toBeLessThan(0.9);
    expect(d.bottleneck).toMatch(/availability/i);
  });
});

describe('runMetallurgyDiagnosis — pure aggregate', () => {
  it('aggregates head-grade, recovery, throughput with non-empty evidence', () => {
    const out = runMetallurgyDiagnosis({
      ...GOLD_INPUT,
      recovery_observed_pct: 40,
      plant: { installed_mill_kw: 1500, feed_f80_um: 10_000, product_p80_um: 100, observed_tph: 50 },
    });
    expect(out.mineral_family).toBe('gold');
    expect(out.head_grade.verdict).toBe('economic');
    expect(out.recovery.verdict).toBe('below_envelope');
    expect(out.throughput).not.toBeNull();
    expect(out.evidence_ids.length).toBeGreaterThan(0);
    expect(new Set(out.evidence_ids).size).toBe(out.evidence_ids.length); // deduped
  });

  it('returns null throughput when no plant telemetry', () => {
    expect(runMetallurgyDiagnosis(GOLD_INPUT).throughput).toBeNull();
  });
});

describe('metallurgy-agent — LLM port + deterministic override', () => {
  it('overrides LLM diagnosis verdicts with deterministic ones', async () => {
    const agent = createMetallurgyAgent({ claude: claudeOf(LLM_PAYLOAD) });
    const out = await agent.processInput({ ...GOLD_INPUT, recovery_observed_pct: 40 });
    // LLM said high_grade / at_best_practice — deterministic wins.
    expect(out.head_grade_verdict).toBe('economic');
    expect(out.recovery_verdict).toBe('below_envelope');
    expect(out.recovery_envelope_pct.low).toBe(MINERAL_PROFILES.gold.recoveryLowPct);
    expect(out.recovery_envelope_pct.high).toBe(MINERAL_PROFILES.gold.recoveryHighPct);
  });

  it('merges deterministic evidence_ids into the audit chain', async () => {
    const agent = createMetallurgyAgent({ claude: claudeOf(LLM_PAYLOAD) });
    const out = await agent.processInput(GOLD_INPUT);
    expect(out.evidence_ids).toContain('llm_dossier_au');
    expect(out.evidence_ids.length).toBeGreaterThan(1);
    expect(new Set(out.evidence_ids).size).toBe(out.evidence_ids.length);
  });

  it('populates throughput_diagnosis when plant telemetry supplied', async () => {
    const agent = createMetallurgyAgent({ claude: claudeOf(LLM_PAYLOAD) });
    const out = await agent.processInput({
      ...GOLD_INPUT,
      plant: { installed_mill_kw: 1500, feed_f80_um: 10_000, product_p80_um: 100, observed_tph: 50 },
    });
    expect(out.throughput_diagnosis).not.toBeNull();
    expect(out.throughput_diagnosis?.effective_nameplate_tph).toBeGreaterThan(0);
  });

  it('exposes a synchronous pure diagnose() that needs no Claude call', () => {
    const agent = createMetallurgyAgent({
      claude: { async complete() { throw new Error('should_not_be_called'); } },
    });
    const d = agent.diagnose({ ...GOLD_INPUT, mineral_family: 'tin', head_grade_g_per_t_or_pct: 0.3 });
    expect(d.mineral_family).toBe('tin');
    expect(d.preferred_routes[0]).toBe('gravity');
  });

  it('rejects empty evidence chain from the LLM (Auditor base) only when deterministic also empty is impossible', async () => {
    // The LLM emitting [] still fails schema validation before merge.
    const agent = createMetallurgyAgent({ claude: claudeOf({ ...LLM_PAYLOAD, evidence_ids: [] }) });
    await expect(agent.processInput(GOLD_INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const agent = createMetallurgyAgent({
      claude: { async complete() { throw new Error('recovery_sim_fail'); } },
    });
    await expect(agent.processInput(GOLD_INPUT)).rejects.toThrow(/recovery_sim_fail/);
  });
});
