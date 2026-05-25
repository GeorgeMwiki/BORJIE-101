/**
 * Biodiversity Net Gain (BNG) — Defra Biodiversity Metric 4.0.
 *
 * UK Environment Act 2021 requires a minimum +10% biodiversity uplift
 * delivered for 30 years on TCPA developments since 12 Feb 2024.
 *
 * Biodiversity Units = Σ (area_ha × distinctiveness × condition ×
 * strategic_significance) with creation / enhancement multipliers
 * and spatial-risk discounts. This calculator implements the core
 * equation per the Metric 4.0 calculation tool (Defra, Mar 2023).
 *
 * It is NOT a replacement for the Defra Metric — the audit-grade
 * number requires the published calculator. This package returns a
 * mathematically faithful estimate plus the explainability trail.
 */

import type {
  BngAssessment,
  BngCondition,
  BngDistinctiveness,
  BngHabitatParcel,
} from '../types.js';

export const BNG_METRIC_VERSION = 'Defra-Metric-4.0';

/** Distinctiveness scores per Defra Metric 4.0. */
export const DISTINCTIVENESS_SCORE: Readonly<Record<BngDistinctiveness, number>> = Object.freeze({
  V_HIGH: 8,
  HIGH:   6,
  MEDIUM: 4,
  LOW:    2,
  V_LOW:  0,
});

/** Condition multipliers. */
export const CONDITION_SCORE: Readonly<Record<BngCondition, number>> = Object.freeze({
  GOOD:     3,
  MODERATE: 2,
  POOR:     1,
  NA:       1,    // not-applicable habitats default to 1
});

/** Strategic-significance multipliers. */
export const STRATEGIC_SCORE: Readonly<Record<BngHabitatParcel['strategicSignificance'], number>> = Object.freeze({
  WITHIN_LOCAL_STRATEGY: 1.15,
  LOCATION_DESIGNATED:   1.10,
  OUTSIDE:               1.0,
});

/** Statutory credit cost (Tier-A, GBP per biodiversity unit). Defra
 *  2024 schedule. Designed to be deliberately high to push toward
 *  on-site or off-site delivery. */
export const STATUTORY_CREDIT_GBP_PER_UNIT = 42_000;

export interface BngInputs {
  readonly siteName: string;
  /** Baseline parcels — what is on-site before development. */
  readonly baseline: ReadonlyArray<BngHabitatParcel>;
  /** Post-development on-site retained + created parcels. */
  readonly postDevelopment: ReadonlyArray<BngHabitatParcel>;
  /** Off-site habitat units delivered or contracted (optional). */
  readonly offSiteUnits?: number;
  /** Legal threshold default 10% per UK Env Act. Override only for
   *  policy stress-testing or non-UK use. */
  readonly thresholdPct?: number;
}

export function computeBngAssessment(inputs: BngInputs): BngAssessment {
  const thresholdPct = inputs.thresholdPct ?? 10;
  const baselineUnits = sumUnits(inputs.baseline);
  const postOnSite = sumUnits(inputs.postDevelopment);
  const postTotal = postOnSite + (inputs.offSiteUnits ?? 0);

  const netGainPct = baselineUnits === 0
    ? (postTotal > 0 ? 100 : 0)
    : ((postTotal - baselineUnits) / baselineUnits) * 100;

  const required = baselineUnits * (1 + thresholdPct / 100);
  const offSiteUnitsRequired = Math.max(0, required - postOnSite);
  const meetsLegalThreshold = postTotal >= required;
  const statutoryCreditCostGBP = meetsLegalThreshold
    ? 0
    : offSiteUnitsRequired * STATUTORY_CREDIT_GBP_PER_UNIT;

  const explainability = [
    `Baseline units: ${round3(baselineUnits)}`,
    `Post-dev on-site: ${round3(postOnSite)}`,
    `Off-site contracted: ${round3(inputs.offSiteUnits ?? 0)}`,
    `Total post-dev units: ${round3(postTotal)}`,
    `Required (≥${thresholdPct}%): ${round3(required)}`,
    `Net change: ${round3(netGainPct)}%`,
    meetsLegalThreshold
      ? `Threshold met on-site + off-site — no statutory credit purchase needed`
      : `Shortfall: ${round3(offSiteUnitsRequired)} units; statutory credit cost £${
          formatNumber(statutoryCreditCostGBP)
        }`,
  ];

  return {
    siteName: inputs.siteName,
    baselineUnits: round3(baselineUnits),
    postDevelopmentUnits: round3(postTotal),
    netGainPct: round3(netGainPct),
    meetsLegalThreshold,
    offSiteUnitsRequired: round3(offSiteUnitsRequired),
    statutoryCreditCostGBP: Math.round(statutoryCreditCostGBP * 100) / 100,
    explainability,
  };
}

export function unitsForParcel(p: BngHabitatParcel): number {
  if (p.area_ha < 0) {
    throw new RangeError(`bng: negative area for parcel ${p.id}`);
  }
  return p.area_ha
    * DISTINCTIVENESS_SCORE[p.distinctiveness]
    * CONDITION_SCORE[p.condition]
    * STRATEGIC_SCORE[p.strategicSignificance];
}

function sumUnits(parcels: ReadonlyArray<BngHabitatParcel>): number {
  return parcels.reduce((acc, p) => acc + unitsForParcel(p), 0);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-GB', { maximumFractionDigits: 0 });
}
