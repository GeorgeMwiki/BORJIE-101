/**
 * EU Taxonomy (Reg 2020/852 + Climate DA 2021/2139 + Env DA 2023/2486)
 * alignment for real-estate activities 7.1 - 7.7.
 *
 * Output captures:
 *   - Substantial Contribution to climate-change mitigation
 *   - DNSH (Do No Significant Harm) per remaining 5 objectives
 *   - Minimum Safeguards (OECD MNE Guidelines, UNGPs)
 *   - Aligned = SC && all-DNSH && safeguards
 *
 * The thresholds here are the *binding* ones from the Delegated Acts.
 */

import type { EuTaxonomyAssessment } from '../types.js';

/** Maximum DNSH water flow rates per EU Taxonomy CCA Annex I. */
export const DNSH_WATER_MAX_L_PER_MIN = Object.freeze({
  kitchen_taps:    6,
  washhand_taps:   6,
  shower_heads:    8,
  wc_flush_full:   6,
  wc_flush_dual:   3,
});

/** EU Taxonomy 7.7 SC criterion for buildings built before 2021. */
export const PRE_2021_REQUIRES_TOP_PCT = 15;

export interface EuTaxonomyInputs {
  readonly activity: '7.1' | '7.2' | '7.3' | '7.4' | '7.5' | '7.6' | '7.7';
  /** ISO year built or last major refurb. */
  readonly yearBuilt: number;
  /** EPC band ('A' best..'G' worst). */
  readonly epcBand: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  /** Is the building in the top 15% of national stock (kWh/m²/yr)? */
  readonly inTop15PctOfStock: boolean;
  /** For 7.1 new build: kWh/m²/yr ≤ NZEB threshold - 10%? */
  readonly meetsNzebMinus10: boolean;
  /** % C&D waste diverted from landfill / incineration (target ≥70%). */
  readonly wasteDiversionPct: number;
  /** Water fittings meet DNSH thresholds? */
  readonly waterFittingsCompliant: boolean;
  /** Indoor VOC paints/floors meet Ecolabel? */
  readonly vocLowEmissions: boolean;
  /** Site is NOT in IUCN I-IV or Natura 2000? */
  readonly biodiversityScreenPasses: boolean;
  /** Climate-risk assessment + adaptation measures in place? */
  readonly adaptationAssessmentDone: boolean;
  /** Operator runs OECD-Guidelines + UNGPs compliant programme? */
  readonly minimumSafeguards: boolean;
}

export function assessEuTaxonomy(inputs: EuTaxonomyInputs): EuTaxonomyAssessment {
  const sc = substantialContribution(inputs);
  const dnsh = {
    water: {
      passes: inputs.waterFittingsCompliant,
      evidence: inputs.waterFittingsCompliant
        ? `Fittings meet DNSH thresholds`
        : `Fittings exceed DNSH max flow (taps ≤6 L/min, showers ≤8 L/min)`,
    },
    circular_economy: {
      passes: inputs.wasteDiversionPct >= 70,
      evidence: `Diversion ${inputs.wasteDiversionPct}% vs DNSH ≥70%`,
    },
    pollution: {
      passes: inputs.vocLowEmissions,
      evidence: inputs.vocLowEmissions
        ? 'Indoor VOCs within Ecolabel limits'
        : 'Indoor VOC threshold not demonstrated',
    },
    biodiversity: {
      passes: inputs.biodiversityScreenPasses,
      evidence: inputs.biodiversityScreenPasses
        ? 'Not on Natura 2000 / IUCN I-IV land'
        : 'Sensitive-land screen flagged risk — EIA required',
    },
    adaptation: {
      passes: inputs.adaptationAssessmentDone,
      evidence: inputs.adaptationAssessmentDone
        ? 'Climate adaptation assessment + measures documented'
        : 'No climate-adaptation assessment on file',
    },
  } as const;

  const allDnshPass = Object.values(dnsh).every((d) => d.passes);
  const aligned = sc && allDnshPass && inputs.minimumSafeguards;

  return {
    activity: inputs.activity,
    substantialContribution: sc,
    dnsh,
    minimumSafeguards: inputs.minimumSafeguards,
    aligned,
    rationale: buildRationale(inputs, sc, dnsh, aligned),
  };
}

function substantialContribution(i: EuTaxonomyInputs): boolean {
  switch (i.activity) {
    case '7.1':
      // New construction (built ≥ 2021): EPB ≤ NZEB − 10%.
      return i.yearBuilt >= 2021 && i.meetsNzebMinus10;
    case '7.2':
      // Renovation: meets large-renovation criterion (assumed via good band).
      return i.epcBand <= 'C';
    case '7.3':
    case '7.4':
    case '7.5':
    case '7.6':
      // Enabling activities — substantial contribution is *intrinsic*
      // to installing EE / EV-charging / measurement / on-site RE.
      return true;
    case '7.7':
      // Acquisition & ownership of existing buildings.
      if (i.yearBuilt < 2021) {
        return i.epcBand === 'A' || i.inTop15PctOfStock;
      }
      return i.meetsNzebMinus10;
    default:
      // exhaustive — at this point activity is `never`.
      return false;
  }
}

function buildRationale(
  i: EuTaxonomyInputs,
  sc: boolean,
  dnsh: EuTaxonomyAssessment['dnsh'],
  aligned: boolean,
): ReadonlyArray<string> {
  const r: string[] = [];
  r.push(`Activity ${i.activity}: substantial contribution = ${sc}`);
  for (const [k, d] of Object.entries(dnsh)) {
    r.push(`DNSH/${k}: ${d.passes ? 'pass' : 'FAIL'} — ${d.evidence}`);
  }
  r.push(`Minimum Safeguards: ${i.minimumSafeguards ? 'met' : 'NOT MET'}`);
  r.push(`Final alignment: ${aligned ? 'ALIGNED' : 'NOT ALIGNED'}`);
  return r;
}
