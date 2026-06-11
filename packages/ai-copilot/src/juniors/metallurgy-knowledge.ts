/**
 * Metallurgy knowledge base — DETERMINISTIC per-mineral processing truth.
 *
 * Grounded in:
 *   - Docs/research/minerals/00_MINERAL_PROCESSING_OVERVIEW.md
 *       (comminution / Bond Work Index, gravity-vs-flotation by SG,
 *        flotation reagent regimes, magnetic/electrostatic, leach chem)
 *   - Docs/research/mining-estate-operating-model.md §3.3
 *       (canonical flowsheet, recovery as the metallurgical yield KPI,
 *        Tanzanian in-country value-addition mandate)
 *   - Docs/research/mining-machinery-advisory.md §3.5 / §2 KPIs
 *       (gravity-ahead-of-CIL, CIL=leach+adsorb, mill ~95% availability,
 *        Availability = MTBF / (MTBF + MTTR))
 *
 * This module is pure: no IO, no LLM, no mutation. The LLM port (in
 * metallurgy-agent.ts) consults these facts; the Auditor can trace
 * every recovery / flowsheet decision to the cited evidence_id below.
 *
 * The agent is NOT gold-only: every mineral family carries its own
 * grade unit, recovery envelope, Bond Work Index band and preferred
 * separation route.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Vocabulary (mirrors metallurgy-agent.ts enums; kept here so the
// deterministic layer is self-contained and independently testable)
// ─────────────────────────────────────────────────────────────────────

export const MINERAL_FAMILIES = [
  'gold',
  'copper',
  'lead_zinc',
  'nickel',
  'cobalt',
  'tin',
  'lithium',
  'rare_earth',
  'graphite',
  'iron_ore',
  'gemstone',
  'diamond',
  'uranium',
] as const;
export type MineralFamilyId = (typeof MINERAL_FAMILIES)[number];

export const SEPARATION_ROUTES = [
  'gravity',
  'flotation',
  'cil',
  'cip',
  'heap_leach',
  'tank_leach',
  'magnetic_separation',
  'electrostatic',
  'dms',
  'solvent_extraction',
] as const;
export type SeparationRoute = (typeof SEPARATION_ROUTES)[number];

/** Grade is expressed in g/t for precious/by-product metals, % for the rest. */
export const GRADE_UNITS = ['g_per_t', 'pct', 'carats_per_hundred_t'] as const;
export type GradeUnit = (typeof GRADE_UNITS)[number];

// ─────────────────────────────────────────────────────────────────────
// Per-mineral parameter record
// ─────────────────────────────────────────────────────────────────────

export interface MineralProfile {
  readonly family: MineralFamilyId;
  /** Unit head grade / cut-off are quoted in. */
  readonly gradeUnit: GradeUnit;
  /**
   * Cut-off-grade ASM/junior reference band (NOT a price-derived cut-off;
   * that is a mine-planner concern). Below `cutoffFloor` the feed is
   * sub-economic for this scale; `cutoffTypical` is a healthy ASM feed.
   */
  readonly cutoffFloor: number;
  readonly cutoffTypical: number;
  /** Best-practice recovery envelope for the primary separation route, %. */
  readonly recoveryLowPct: number;
  readonly recoveryHighPct: number;
  /** Bond Work Index band (kWh/t) — drives comminution energy + throughput. */
  readonly bondWiLow: number;
  readonly bondWiHigh: number;
  /** Ordered preference of separation routes (most→least appropriate). */
  readonly preferredRoutes: ReadonlyArray<SeparationRoute>;
  /** True when cyanidation is a realistic route for this family. */
  readonly cyanideRelevant: boolean;
  /** Naturally-occurring-radioactive-material flag (U/Th/monazite REE). */
  readonly norm: boolean;
  /** evidence_id the recovery/route facts trace to. */
  readonly evidenceId: string;
  /** One-line route rationale (deterministic, audit-readable). */
  readonly note: string;
}

const DOSSIER = 'research/minerals/00_MINERAL_PROCESSING_OVERVIEW.md';
const OPMODEL = 'research/mining-estate-operating-model.md#3.3';

/**
 * The deterministic per-mineral truth table. Numbers are best-practice
 * envelopes from the cited dossiers, deliberately conservative for the
 * artisanal-to-mid-tier reality Borjie serves.
 */
export const MINERAL_PROFILES: Readonly<Record<MineralFamilyId, MineralProfile>> = {
  gold: {
    family: 'gold',
    gradeUnit: 'g_per_t',
    cutoffFloor: 0.5,
    cutoffTypical: 3.0,
    recoveryLowPct: 60,
    recoveryHighPct: 95,
    bondWiLow: 14,
    bondWiHigh: 18,
    preferredRoutes: ['gravity', 'cil', 'flotation'],
    cyanideRelevant: true,
    norm: false,
    evidenceId: `${OPMODEL}|au-gravity-cil`,
    note: 'Gravity ahead of CIL captures coarse free gold mercury-free; CIL is the mid-tier workhorse.',
  },
  copper: {
    family: 'copper',
    gradeUnit: 'pct',
    cutoffFloor: 0.25,
    cutoffTypical: 0.6,
    recoveryLowPct: 80,
    recoveryHighPct: 92,
    bondWiLow: 12,
    bondWiHigh: 16,
    preferredRoutes: ['flotation', 'heap_leach', 'solvent_extraction'],
    cyanideRelevant: false,
    norm: false,
    evidenceId: `${DOSSIER}|cu-flotation-sxew`,
    note: 'Sulphide Cu floats (SIPX+lime, depress pyrite); oxide Cu goes acid heap-leach→SX-EW.',
  },
  lead_zinc: {
    family: 'lead_zinc',
    gradeUnit: 'pct',
    cutoffFloor: 1.5,
    cutoffTypical: 5.0,
    recoveryLowPct: 75,
    recoveryHighPct: 90,
    bondWiLow: 11,
    bondWiHigh: 15,
    preferredRoutes: ['flotation', 'gravity'],
    cyanideRelevant: false,
    norm: false,
    evidenceId: `${DOSSIER}|pbzn-differential-flotation`,
    note: 'Differential flotation: float galena first (depress sphalerite), then activate+float sphalerite.',
  },
  nickel: {
    family: 'nickel',
    gradeUnit: 'pct',
    cutoffFloor: 0.5,
    cutoffTypical: 1.5,
    recoveryLowPct: 70,
    recoveryHighPct: 88,
    bondWiLow: 12,
    bondWiHigh: 18,
    preferredRoutes: ['flotation', 'tank_leach', 'solvent_extraction'],
    cyanideRelevant: false,
    norm: false,
    evidenceId: `${DOSSIER}|ni-sulphide-float-laterite-leach`,
    note: 'Sulphide Ni floats; laterite Ni needs HPAL/Caron ammonia leach (capital-heavy).',
  },
  cobalt: {
    family: 'cobalt',
    gradeUnit: 'pct',
    cutoffFloor: 0.1,
    cutoffTypical: 0.5,
    recoveryLowPct: 65,
    recoveryHighPct: 85,
    bondWiLow: 12,
    bondWiHigh: 16,
    preferredRoutes: ['flotation', 'tank_leach', 'solvent_extraction'],
    cyanideRelevant: false,
    norm: false,
    evidenceId: `${DOSSIER}|co-byproduct-leach-sx`,
    note: 'Usually a Cu/Ni by-product; recovered by leach→SX→hydroxide/MHP precipitation.',
  },
  tin: {
    family: 'tin',
    gradeUnit: 'pct',
    cutoffFloor: 0.1,
    cutoffTypical: 0.4,
    recoveryLowPct: 65,
    recoveryHighPct: 85,
    bondWiLow: 12,
    bondWiHigh: 18,
    preferredRoutes: ['gravity', 'magnetic_separation'],
    cyanideRelevant: false,
    norm: false,
    evidenceId: `${DOSSIER}|sn-cassiterite-gravity`,
    note: 'Cassiterite SG≈6.8-7.1 → gravity-dominant (jig/table/spiral); magnetic clean-up of by-products.',
  },
  lithium: {
    family: 'lithium',
    gradeUnit: 'pct',
    cutoffFloor: 0.5,
    cutoffTypical: 1.0,
    recoveryLowPct: 60,
    recoveryHighPct: 80,
    bondWiLow: 12,
    bondWiHigh: 17,
    preferredRoutes: ['flotation', 'dms', 'gravity'],
    cyanideRelevant: false,
    norm: false,
    evidenceId: `${DOSSIER}|li-spodumene-dms-reverse-float`,
    note: 'Hard-rock spodumene: DMS pre-concentration then reverse flotation (depress mica first).',
  },
  rare_earth: {
    family: 'rare_earth',
    gradeUnit: 'pct',
    cutoffFloor: 1.0,
    cutoffTypical: 3.0,
    recoveryLowPct: 50,
    recoveryHighPct: 75,
    bondWiLow: 12,
    bondWiHigh: 18,
    preferredRoutes: ['gravity', 'magnetic_separation', 'flotation'],
    cyanideRelevant: false,
    norm: true,
    evidenceId: `${DOSSIER}|ree-monazite-gravity-magnetic-norm`,
    note: 'Monazite REE: gravity+WHIMS then hydroxamate flotation; NORM (Th) — requires IAEA-equivalent handling.',
  },
  graphite: {
    family: 'graphite',
    gradeUnit: 'pct',
    cutoffFloor: 3.0,
    cutoffTypical: 8.0,
    recoveryLowPct: 80,
    recoveryHighPct: 95,
    bondWiLow: 7,
    bondWiHigh: 13,
    preferredRoutes: ['flotation'],
    cyanideRelevant: false,
    norm: false,
    evidenceId: `${DOSSIER}|graphite-flotation-flake-preserve`,
    note: 'Naturally floatable; gentle multi-stage cleaner flotation to preserve large flake (value driver).',
  },
  iron_ore: {
    family: 'iron_ore',
    gradeUnit: 'pct',
    cutoffFloor: 25,
    cutoffTypical: 55,
    recoveryLowPct: 70,
    recoveryHighPct: 95,
    bondWiLow: 14,
    bondWiHigh: 22,
    preferredRoutes: ['magnetic_separation', 'gravity', 'dms'],
    cyanideRelevant: false,
    norm: false,
    evidenceId: `${DOSSIER}|fe-magnetite-lims-hematite-dms`,
    note: 'Magnetite→LIMS; hematite→gravity/DMS or reverse-cationic-flotation of quartz.',
  },
  gemstone: {
    family: 'gemstone',
    gradeUnit: 'carats_per_hundred_t',
    cutoffFloor: 1,
    cutoffTypical: 10,
    recoveryLowPct: 70,
    recoveryHighPct: 95,
    bondWiLow: 8,
    bondWiHigh: 14,
    preferredRoutes: ['gravity', 'dms'],
    cyanideRelevant: false,
    norm: false,
    evidenceId: `${DOSSIER}|gem-handsort-dms-grease`,
    note: 'Coloured gems: gentle gravity + hand-sort; never high-energy crush that fractures crystals.',
  },
  diamond: {
    family: 'diamond',
    gradeUnit: 'carats_per_hundred_t',
    cutoffFloor: 1,
    cutoffTypical: 20,
    recoveryLowPct: 85,
    recoveryHighPct: 98,
    bondWiLow: 8,
    bondWiHigh: 14,
    preferredRoutes: ['dms', 'gravity'],
    cyanideRelevant: false,
    norm: false,
    evidenceId: `${DOSSIER}|diamond-dms-xray-bulk-sample`,
    note: 'FeSi DMS (SG 2.7-3.2) + X-ray/grease final recovery; bulk-sample, never assay, to grade.',
  },
  uranium: {
    family: 'uranium',
    gradeUnit: 'pct',
    cutoffFloor: 0.03,
    cutoffTypical: 0.1,
    recoveryLowPct: 80,
    recoveryHighPct: 95,
    bondWiLow: 12,
    bondWiHigh: 18,
    preferredRoutes: ['tank_leach', 'heap_leach', 'solvent_extraction'],
    cyanideRelevant: false,
    norm: true,
    evidenceId: `${DOSSIER}|u-acid-alkaline-leach-sx-ix-norm`,
    note: 'Acid/alkaline leach→SX/IX→yellowcake; NORM — IAEA-equivalent licensing before any extraction.',
  },
};

export function getMineralProfile(family: MineralFamilyId): MineralProfile {
  return MINERAL_PROFILES[family];
}

// ─────────────────────────────────────────────────────────────────────
// Cut-off vs head-grade economics (deterministic)
// ─────────────────────────────────────────────────────────────────────

export const HeadGradeVerdict = z.enum(['below_cutoff', 'marginal', 'economic', 'high_grade']);
export type HeadGradeVerdict = z.infer<typeof HeadGradeVerdict>;

export interface HeadGradeAssessment {
  readonly verdict: HeadGradeVerdict;
  readonly head_grade: number;
  readonly cutoff_floor: number;
  readonly cutoff_typical: number;
  readonly grade_unit: GradeUnit;
  /** head_grade / cutoff_floor — how far above the sub-economic floor. */
  readonly ratio_to_floor: number;
  readonly evidence_id: string;
}

/**
 * Compare a head grade against the per-mineral cut-off band. Deterministic;
 * an effective_cutoff may be supplied by the mine-planner (price-derived)
 * and overrides the dossier floor when provided.
 */
export function assessHeadGrade(
  family: MineralFamilyId,
  headGrade: number,
  effectiveCutoff?: number,
): HeadGradeAssessment {
  const profile = MINERAL_PROFILES[family];
  const floor = effectiveCutoff !== undefined && effectiveCutoff > 0 ? effectiveCutoff : profile.cutoffFloor;
  const typical = Math.max(profile.cutoffTypical, floor * 1.5);
  const ratio = floor > 0 ? round2(headGrade / floor) : 0;
  const verdict: HeadGradeVerdict =
    headGrade < floor
      ? 'below_cutoff'
      : headGrade < typical
        ? 'marginal'
        : headGrade < typical * 2
          ? 'economic'
          : 'high_grade';
  return {
    verdict,
    head_grade: headGrade,
    cutoff_floor: floor,
    cutoff_typical: typical,
    grade_unit: profile.gradeUnit,
    ratio_to_floor: ratio,
    evidence_id: profile.evidenceId,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Recovery KPI diagnosis (deterministic)
// ─────────────────────────────────────────────────────────────────────

export const RecoveryVerdict = z.enum([
  'no_baseline',
  'below_envelope',
  'in_envelope',
  'at_best_practice',
]);
export type RecoveryVerdict = z.infer<typeof RecoveryVerdict>;

export interface RecoveryDiagnosis {
  readonly verdict: RecoveryVerdict;
  readonly observed_pct: number | null;
  readonly envelope_low_pct: number;
  readonly envelope_high_pct: number;
  /** observed − envelope_low, negative when underperforming. */
  readonly gap_to_envelope_pct: number;
  readonly likely_causes: ReadonlyArray<string>;
  readonly evidence_id: string;
}

/**
 * Diagnose an observed metallurgical recovery against the per-mineral
 * best-practice envelope and surface deterministic likely-cause hints.
 * Recovery is THE metallurgical yield KPI (op-model §3.3).
 */
export function diagnoseRecovery(
  family: MineralFamilyId,
  observedPct: number | null | undefined,
): RecoveryDiagnosis {
  const profile = MINERAL_PROFILES[family];
  if (observedPct === null || observedPct === undefined) {
    return {
      verdict: 'no_baseline',
      observed_pct: null,
      envelope_low_pct: profile.recoveryLowPct,
      envelope_high_pct: profile.recoveryHighPct,
      gap_to_envelope_pct: 0,
      likely_causes: ['No observed recovery supplied — run a mass-balanced metallurgical test campaign.'],
      evidence_id: profile.evidenceId,
    };
  }
  const gap = round2(observedPct - profile.recoveryLowPct);
  const verdict: RecoveryVerdict =
    observedPct < profile.recoveryLowPct
      ? 'below_envelope'
      : observedPct >= profile.recoveryHighPct
        ? 'at_best_practice'
        : 'in_envelope';
  return {
    verdict,
    observed_pct: observedPct,
    envelope_low_pct: profile.recoveryLowPct,
    envelope_high_pct: profile.recoveryHighPct,
    gap_to_envelope_pct: gap,
    likely_causes: verdict === 'below_envelope' ? recoveryLossCauses(family) : [],
    evidence_id: profile.evidenceId,
  };
}

/**
 * Deterministic recovery-loss hypotheses, ordered by per-family
 * likelihood. Grounded in the comminution/liberation + route notes.
 */
function recoveryLossCauses(family: MineralFamilyId): ReadonlyArray<string> {
  const shared = [
    'Under-grind: valuable mineral not liberated (raise grind fineness toward liberation p80).',
    'Over-grind slimes: ultra-fines lost to tailings (check cyclone classification).',
  ];
  const perFamily: Partial<Record<MineralFamilyId, ReadonlyArray<string>>> = {
    gold: [
      'Coarse free gold bypassing leach — add/repair a gravity circuit ahead of CIL.',
      'Refractory/sulphide-locked gold — consider flotation+roast/bio-oxidation pre-treatment.',
      'Carbon fouling or low residence time in CIL adsorption tanks.',
    ],
    copper: [
      'Pyrite floating with chalcopyrite — raise lime/pH to depress pyrite.',
      'Oxide Cu reporting to flotation tails — route oxide fraction to acid leach instead.',
    ],
    lead_zinc: ['Mutual activation — re-sequence galena/sphalerite differential float and depressant dosing.'],
    iron_ore: ['Magnetic field too low for hematite — step LIMS up to WHIMS intensity.'],
    graphite: ['Aggressive milling shattering flake — soften regrind to preserve large-flake premium.'],
    tin: ['Fine cassiterite lost on tables — add centrifugal/MGS for the <100µm fraction.'],
  };
  return [...(perFamily[family] ?? []), ...shared];
}

// ─────────────────────────────────────────────────────────────────────
// Throughput diagnosis (deterministic — Bond third law + availability)
// ─────────────────────────────────────────────────────────────────────

export interface ThroughputInput {
  readonly family: MineralFamilyId;
  /** Installed grinding power available to the mill (kW). */
  readonly installed_mill_kw: number;
  /** Mill feed top size F80 (µm). */
  readonly feed_f80_um: number;
  /** Target product P80 (µm) at liberation. */
  readonly product_p80_um: number;
  /** Observed plant throughput, t/h (optional — for vs-capacity gap). */
  readonly observed_tph?: number;
  /** Mean time between failures (h) and mean time to repair (h). */
  readonly mtbf_h?: number;
  readonly mttr_h?: number;
}

export interface ThroughputDiagnosis {
  /** Specific comminution energy, kWh/t (Bond third law, mid-Wi). */
  readonly specific_energy_kwh_per_t: number;
  /** Power-limited capacity = installed_kW / specific_energy, t/h. */
  readonly power_limited_tph: number;
  /** Mechanical availability = MTBF / (MTBF + MTTR), fraction. */
  readonly availability: number;
  /** Effective nameplate after availability haircut, t/h. */
  readonly effective_nameplate_tph: number;
  /** observed / effective_nameplate, fraction (null when no observation). */
  readonly utilisation_vs_nameplate: number | null;
  readonly verdict: 'no_baseline' | 'underperforming' | 'at_nameplate';
  readonly bottleneck: string;
  readonly evidence_id: string;
}

/** Bond's third law: W = 10·Wi·(1/√P80 − 1/√F80), µm in, kWh/t out. */
export function bondSpecificEnergy(wi: number, f80um: number, p80um: number): number {
  if (f80um <= 0 || p80um <= 0) return 0;
  const w = 10 * wi * (1 / Math.sqrt(p80um) - 1 / Math.sqrt(f80um));
  return round2(Math.max(w, 0));
}

/**
 * Diagnose plant throughput against power-limited capacity and the
 * mechanical-availability haircut. Mills are designed for ~95%
 * availability (machinery-advisory §2); below that, downtime is the
 * bottleneck, not grinding power.
 */
export function diagnoseThroughput(input: ThroughputInput): ThroughputDiagnosis {
  const profile = MINERAL_PROFILES[input.family];
  const wiMid = round2((profile.bondWiLow + profile.bondWiHigh) / 2);
  const specificEnergy = bondSpecificEnergy(wiMid, input.feed_f80_um, input.product_p80_um);
  const powerLimited = specificEnergy > 0 ? round2(input.installed_mill_kw / specificEnergy) : 0;
  const availability = mechanicalAvailability(input.mtbf_h, input.mttr_h);
  const effectiveNameplate = round2(powerLimited * availability);
  const utilisation =
    input.observed_tph !== undefined && effectiveNameplate > 0
      ? round2(input.observed_tph / effectiveNameplate)
      : null;
  const verdict =
    utilisation === null ? 'no_baseline' : utilisation < 0.9 ? 'underperforming' : 'at_nameplate';
  return {
    specific_energy_kwh_per_t: specificEnergy,
    power_limited_tph: powerLimited,
    availability,
    effective_nameplate_tph: effectiveNameplate,
    utilisation_vs_nameplate: utilisation,
    verdict,
    bottleneck: throughputBottleneck(availability, utilisation),
    evidence_id: `${DOSSIER}|bond-wi-comminution`,
  };
}

/** Availability = MTBF / (MTBF + MTTR); defaults to mill best-practice 0.95. */
function mechanicalAvailability(mtbf?: number, mttr?: number): number {
  if (mtbf === undefined || mttr === undefined || mtbf <= 0 || mtbf + mttr <= 0) return 0.95;
  return round2(mtbf / (mtbf + mttr));
}

function throughputBottleneck(availability: number, utilisation: number | null): string {
  if (utilisation === null) return 'No observed throughput — instrument the mill feed before diagnosing.';
  if (availability < 0.9) return 'Mechanical availability below 90% — downtime (liners/bearings) is the limiter.';
  if (utilisation < 0.9) return 'Grinding power / feed-size limited — re-balance crush product or add mill power.';
  return 'Plant is running at effective nameplate — gains need a capacity upgrade, not optimisation.';
}

// ─────────────────────────────────────────────────────────────────────
// Pure utility
// ─────────────────────────────────────────────────────────────────────

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
