/**
 * Property ESG advisor — aggregates calculator outputs into a single
 * `PropertyEsg` report with an executive summary written in the voice
 * of a veteran sustainability advisor (Head of ESG, 15+ years).
 *
 * Pure function. Every sub-calculation is dependency-injected via
 * the inputs, so the advisor itself remains the simplest, most
 * testable layer of the package.
 */

import type {
  BngAssessment,
  CarbonReport,
  EuTaxonomyAssessment,
  GreenRating,
  KgCO2e,
  NbsOpportunity,
  PropertyDescriptor,
  PropertyEsg,
  ReportingPeriod,
  SbtnTargetSuggestion,
} from '../types.js';

export interface PropertyEsgInputs {
  readonly property: PropertyDescriptor;
  readonly period: ReportingPeriod;
  readonly carbon: CarbonReport;
  readonly ratings: ReadonlyArray<GreenRating>;
  readonly euTaxonomy: EuTaxonomyAssessment | null;
  readonly biodiversity: BngAssessment | null;
  readonly nbsOpportunities: ReadonlyArray<NbsOpportunity>;
  readonly recommendedTargets: ReadonlyArray<SbtnTargetSuggestion>;
}

export function buildPropertyEsgReport(inputs: PropertyEsgInputs): PropertyEsg {
  const summary = buildExecutiveSummary(inputs);
  const notes = buildVeteranNotes(inputs);
  return {
    property: inputs.property,
    period: inputs.period,
    carbon: inputs.carbon,
    ratings: inputs.ratings,
    euTaxonomy: inputs.euTaxonomy,
    biodiversity: inputs.biodiversity,
    nbsOpportunities: inputs.nbsOpportunities,
    recommendedTargets: inputs.recommendedTargets,
    executiveSummary: summary,
    veteranAdvisorNotes: notes,
  };
}

function buildExecutiveSummary(i: PropertyEsgInputs): string {
  const totalT = (i.carbon.totalOperationalKgCO2e / 1000).toFixed(1);
  const intensity = i.carbon.intensityKgCO2ePerM2.toFixed(1);
  const bestRating = bestRated(i.ratings);
  const ratingLine = bestRating
    ? `Indicative ${bestRating.scheme} band: ${bestRating.estimatedBand} (${bestRating.percent.toFixed(0)}%).`
    : 'No green-building rating estimate filed.';
  const taxLine = i.euTaxonomy
    ? `EU Taxonomy 7.7: ${i.euTaxonomy.aligned ? 'ALIGNED' : 'NOT ALIGNED'} — ${
        i.euTaxonomy.rationale[i.euTaxonomy.rationale.length - 1] ?? ''
      }`
    : 'EU Taxonomy alignment not assessed.';
  const bngLine = i.biodiversity
    ? `BNG: ${i.biodiversity.netGainPct.toFixed(1)}% (${
        i.biodiversity.meetsLegalThreshold ? 'meets ≥10% threshold' : 'below threshold'
      }).`
    : 'BNG assessment not filed.';

  return [
    `Property ${i.property.propertyId} (${i.property.assetClass}, ${i.property.country})`,
    `Reporting period: ${i.period.financialYear} (${i.period.periodStart} → ${i.period.periodEnd}).`,
    ``,
    `Operational footprint: ${totalT} tCO2e, intensity ${intensity} kgCO2e/m² GIA.`,
    ratingLine,
    taxLine,
    bngLine,
    ``,
    `Top NbS opportunities: ${i.nbsOpportunities.slice(0, 3).map((n) => n.intervention).join(', ') || 'none ranked'}.`,
    `Recommended SBTN targets: ${i.recommendedTargets.length} surfaced.`,
  ].join('\n');
}

function buildVeteranNotes(i: PropertyEsgInputs): ReadonlyArray<string> {
  const notes: string[] = [];
  const intensity = i.carbon.intensityKgCO2ePerM2;
  const ee = i.carbon.embodied;

  // Operational intensity benchmarks vs CRREM pathways.
  if (intensity > 80) {
    notes.push('Operational intensity well above CRREM 1.5 °C pathway — a stranded-asset risk to flag with the asset manager.');
  } else if (intensity > 40) {
    notes.push('Intensity within CRREM 2 °C corridor but on the wrong side of 1.5 °C — refurb capex case is bankable.');
  } else {
    notes.push('Intensity tracks CRREM 1.5 °C pathway — protect this position by retiring residual emissions on a credible 30-yr Article 6.4 / Gold-Standard strip.');
  }

  // Embodied carbon.
  if (ee && ee.intensityPerM2 > 900) {
    notes.push('Embodied intensity is high (>900 kg/m²); push the structural team toward GGBS-rich concrete or a CLT alternative — typically 30-40% upfront reduction.');
  }

  // EU Taxonomy.
  if (i.euTaxonomy && !i.euTaxonomy.aligned) {
    notes.push('Not Taxonomy-aligned: this drags the GAR (Green Asset Ratio) of any lender financing this asset — expect tougher margin pricing.');
  }

  // Biodiversity.
  if (i.biodiversity && !i.biodiversity.meetsLegalThreshold) {
    notes.push(`BNG shortfall would require £${formatN(i.biodiversity.statutoryCreditCostGBP)} of statutory credits — almost always cheaper to deliver on- or off-site.`);
  }

  // Disclosure timing.
  if (['GB', 'FR', 'DE', 'NL', 'IT', 'ES', 'IE', 'BE'].includes(i.property.country)) {
    notes.push('Entity falls inside the EU CSRD / UK SDR perimeter — IFRS S2 disclosure is mandatory from FY26; ensure scope-3 (PCAF Part A) is audit-ready by year-end.');
  }

  // East Africa.
  if (['KE', 'TZ', 'UG', 'RW', 'BI', 'SS'].includes(i.property.country)) {
    notes.push('EAC asset: Kenya NEMA / Tanzania NEMC EIA annual audit is the binding compliance event; align this report to that statutory cycle.');
    notes.push('Consider EDGE certification (lower cost-to-certify than BREEAM/LEED) and a small annual VCS-grade-B Kenyan cookstove offset retirement via M-PESA Green for transparent + locally-banked offsetting.');
  }

  return notes;
}

function bestRated(ratings: ReadonlyArray<GreenRating>): GreenRating | null {
  if (ratings.length === 0) return null;
  return [...ratings].sort((a, b) => b.percent - a.percent)[0] ?? null;
}

function formatN(n: number): string {
  return n.toLocaleString('en-GB', { maximumFractionDigits: 0 });
}

/**
 * Convenience: compute the operational total + intensity from sub-reports.
 */
export function rollupCarbon(args: {
  readonly propertyId: string;
  readonly period: ReportingPeriod;
  readonly grossInternalArea_m2: number;
  readonly scope1: CarbonReport['scope1'];
  readonly scope2: CarbonReport['scope2'];
  readonly scope3: CarbonReport['scope3'] | null;
  readonly embodied: CarbonReport['embodied'] | null;
}): CarbonReport {
  if (args.grossInternalArea_m2 <= 0) {
    throw new RangeError('rollupCarbon: GIA must be > 0');
  }
  const s3Total: KgCO2e = args.scope3?.totalKgCO2e ?? 0;
  const totalOp = args.scope1.totalKgCO2e
    + args.scope2.totalKgCO2eMarketBased
    + s3Total;
  return {
    propertyId: args.propertyId,
    period: args.period,
    scope1: args.scope1,
    scope2: args.scope2,
    scope3: args.scope3,
    embodied: args.embodied,
    totalOperationalKgCO2e: round3(totalOp),
    intensityKgCO2ePerM2: round3(totalOp / args.grossInternalArea_m2),
    generatedAt: new Date().toISOString(),
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
