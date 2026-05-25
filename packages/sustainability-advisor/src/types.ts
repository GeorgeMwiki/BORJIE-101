/**
 * Public types for `@borjie/sustainability-advisor`.
 *
 * Pure type module — no runtime. Every type is `readonly` end-to-end
 * so consumers cannot mutate report fragments after they are produced.
 *
 * The advisor is a calculator and an evidence-pack assembler — it
 * never claims to issue certificates. Where the underlying scheme
 * (BREEAM/LEED/EDGE/EPC) requires an accredited assessor, our output
 * is an `estimate` with a documented confidence band, plus a list of
 * the inputs that would tighten the estimate.
 */

// ─────────────────────────────────────────────────────────────────────
// Common shapes
// ─────────────────────────────────────────────────────────────────────

/** ISO-3166-1 alpha-2 country code (e.g. 'KE', 'TZ', 'GB', 'US'). */
export type CountryCode = string;

/** ISO-4217 currency code (e.g. 'KES', 'TZS', 'GBP', 'EUR', 'USD'). */
export type CurrencyCode = string;

export const ASSET_CLASSES = [
  'residential',
  'office',
  'retail',
  'industrial',
  'hotel',
  'mixed_use',
  'healthcare',
  'education',
  'student_housing',
  'logistics',
  'data_center',
] as const;

export type AssetClass = (typeof ASSET_CLASSES)[number];

export const CLIMATE_ZONES = [
  /** Köppen-Geiger major groups, sufficient for NbS recommender. */
  'tropical_rainforest',
  'tropical_monsoon',
  'tropical_savanna',
  'arid_desert',
  'arid_steppe',
  'temperate_oceanic',
  'temperate_continental',
  'temperate_mediterranean',
  'cold',
  'polar',
] as const;

export type ClimateZone = (typeof CLIMATE_ZONES)[number];

/**
 * Building physical envelope and operating boundary. Every calculator
 * accepts this as the first arg so the same building description
 * flows through GHG, ratings, embodied, and disclosures.
 */
export interface PropertyDescriptor {
  readonly propertyId: string;
  readonly tenantId: string;        // org owning the data, NOT lessee
  readonly country: CountryCode;
  readonly assetClass: AssetClass;
  readonly climateZone: ClimateZone;
  /** Gross Internal Area in m² (RICS IPMS 2). */
  readonly grossInternalArea_m2: number;
  /** Year of construction (or last deep retrofit). */
  readonly yearBuilt: number;
  /** Number of stories. */
  readonly stories: number;
  /** Occupancy headcount (FTE-equivalent or beds for resi). */
  readonly occupancy: number;
  /** Is the building all-electric (no on-site fossil)?
   *  Used by EDGE + LEED v5 to short-circuit gas factors. */
  readonly allElectric: boolean;
}

/**
 * Operating period for an accounting year. Reporting must use a
 * 12-month window aligned with the entity's financial year.
 */
export interface ReportingPeriod {
  readonly periodStart: string;  // ISO date
  readonly periodEnd: string;    // ISO date
  readonly financialYear: string; // e.g. "FY26" or "2026"
}

// ─────────────────────────────────────────────────────────────────────
// GHG Protocol output shapes — Scope 1 / 2 / 3 + embodied
// ─────────────────────────────────────────────────────────────────────

/** kgCO2e — base unit for ALL emission flows in the package. */
export type KgCO2e = number;

export interface EmissionLine {
  readonly source: string;       // e.g. 'natural_gas', 'grid_electricity'
  readonly activity: number;     // e.g. kWh, litres, kg
  readonly activityUnit: string; // e.g. 'kWh', 'L', 'kg'
  readonly factor: number;       // kgCO2e per activity unit
  readonly factorSource: string; // e.g. 'DEFRA 2024'
  readonly kgCO2e: KgCO2e;
}

export interface Scope1Report {
  readonly scope: 1;
  readonly lines: ReadonlyArray<EmissionLine>;
  readonly totalKgCO2e: KgCO2e;
}

export interface Scope2Report {
  readonly scope: 2;
  readonly locationBased: EmissionLine;
  readonly marketBased: EmissionLine;
  readonly renewablesCertificatesKWh: number;
  readonly totalKgCO2eMarketBased: KgCO2e;
  readonly totalKgCO2eLocationBased: KgCO2e;
}

export interface Scope3Report {
  readonly scope: 3;
  /** PCAF-aligned categories where present. */
  readonly categoryBreakdown: Readonly<Record<string, KgCO2e>>;
  readonly lines: ReadonlyArray<EmissionLine>;
  readonly totalKgCO2e: KgCO2e;
}

export interface EmbodiedCarbonReport {
  readonly scope: 'embodied';
  /** EN 15978 module A1-A3 (product). */
  readonly productKgCO2e: KgCO2e;
  /** A4 (transport to site). */
  readonly transportKgCO2e: KgCO2e;
  /** A5 (construction/installation). */
  readonly constructionKgCO2e: KgCO2e;
  /** C1-C4 (end-of-life). */
  readonly endOfLifeKgCO2e: KgCO2e;
  /** Whole-life upfront (A1-A5). */
  readonly upfrontKgCO2e: KgCO2e;
  /** Indicative kgCO2e/m² GIA upfront. */
  readonly intensityPerM2: KgCO2e;
  /** Material breakdown — material → kgCO2e. */
  readonly materialBreakdown: Readonly<Record<string, KgCO2e>>;
}

/** Aggregate cross-scope. */
export interface CarbonReport {
  readonly propertyId: string;
  readonly period: ReportingPeriod;
  readonly scope1: Scope1Report;
  readonly scope2: Scope2Report;
  readonly scope3: Scope3Report | null;
  readonly embodied: EmbodiedCarbonReport | null;
  readonly totalOperationalKgCO2e: KgCO2e;     // S1 + S2 (market-based) + S3
  readonly intensityKgCO2ePerM2: KgCO2e;
  readonly generatedAt: string;                // ISO
}

// ─────────────────────────────────────────────────────────────────────
// Green-building rating outputs
// ─────────────────────────────────────────────────────────────────────

export type RatingScheme =
  | 'BREEAM'
  | 'LEED'
  | 'GreenStar'
  | 'EDGE'
  | 'CASBEE'
  | 'DGNB'
  | 'EPC';

export interface RatingCategoryScore {
  readonly category: string;
  readonly scoredPoints: number;
  readonly maxPoints: number;
  /** Plain-language explanation of how we scored it. */
  readonly rationale: string;
}

export interface GreenRating {
  readonly scheme: RatingScheme;
  readonly version: string;
  readonly totalScore: number;
  readonly maxScore: number;
  readonly percent: number;
  readonly estimatedBand: string; // e.g. 'Very Good', 'Gold', 'A'
  readonly categories: ReadonlyArray<RatingCategoryScore>;
  /** What inputs would tighten the estimate by ≥5 pts. */
  readonly nextBestInputs: ReadonlyArray<string>;
  /** Indicative confidence: stub | low | medium | high. */
  readonly confidence: 'stub' | 'low' | 'medium' | 'high';
}

export interface CertificationProspect {
  readonly scheme: RatingScheme;
  readonly currentBandEstimate: string;
  readonly nextBandTarget: string;
  /** Indicative additional capex per m². */
  readonly indicativeCapexPerM2: number;
  /** Indicative payback in years. */
  readonly paybackYears: number;
  /** Top 3 interventions ranked by points-per-£. */
  readonly recommendedInterventions: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Credits + EU Taxonomy
// ─────────────────────────────────────────────────────────────────────

export type CreditStandard =
  | 'VCS'           // Verra
  | 'GoldStandard'
  | 'EU_ETS'        // compliance market
  | 'Article_6_4'   // UN PACM
  | 'CDM_legacy'
  | 'REDD_plus';

export interface CarbonCreditQuote {
  readonly standard: CreditStandard;
  readonly tonnesCO2e: number;
  /** Spot price in `currency` per tCO2e. */
  readonly spotPrice: number;
  readonly currency: CurrencyCode;
  /** Spot total = spotPrice * tonnes. */
  readonly spotTotal: number;
  /** Forward / strip prices keyed by tenor (e.g. 'Dec-26', '2027'). */
  readonly forwards: Readonly<Record<string, number>>;
  /** Sylvera-style grade A..D (or null if not engineered). */
  readonly qualityGrade: 'A' | 'B' | 'C' | 'D' | null;
  readonly asOf: string;            // ISO
  readonly feedSource: string;      // adapter name
}

export interface EuTaxonomyAssessment {
  readonly activity: '7.1' | '7.2' | '7.3' | '7.4' | '7.5' | '7.6' | '7.7';
  /** Substantial Contribution to climate-change mitigation. */
  readonly substantialContribution: boolean;
  /** Do-No-Significant-Harm checklist. */
  readonly dnsh: Readonly<Record<
    'water' | 'circular_economy' | 'pollution' | 'biodiversity' | 'adaptation',
    { readonly passes: boolean; readonly evidence: string }
  >>;
  readonly minimumSafeguards: boolean;
  readonly aligned: boolean;
  /** Reasons the activity is/isn't aligned — narrative. */
  readonly rationale: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Disclosures
// ─────────────────────────────────────────────────────────────────────

export interface TcfdNarrative {
  readonly governance: string;
  readonly strategy: string;
  readonly riskManagement: string;
  readonly metricsAndTargets: string;
}

export interface IfrsS2DisclosurePack {
  readonly entity: string;
  readonly period: ReportingPeriod;
  readonly governance: string;
  readonly strategy: string;
  readonly riskManagement: string;
  readonly crossIndustryMetrics: Readonly<{
    readonly scope1KgCO2e: KgCO2e;
    readonly scope2LocationKgCO2e: KgCO2e;
    readonly scope2MarketKgCO2e: KgCO2e;
    readonly scope3KgCO2e: KgCO2e;
    readonly transitionRiskExposure: string;
    readonly physicalRiskExposure: string;
    readonly climateCapexPct: number;
    readonly internalCarbonPricePerTonne: number | null;
  }>;
  readonly industryMetricsRealEstate: Readonly<{
    readonly siteEnergyMWh: number;
    readonly gridElectricityPct: number;
    readonly renewableElectricityPct: number;
    readonly likeForLikeScope1Plus2KgCO2e: KgCO2e;
    readonly waterWithdrawalM3: number;
    readonly certifiedGfaPct: number;
  }>;
  readonly targets: ReadonlyArray<{
    readonly metric: string;
    readonly target: number;
    readonly unit: string;
    readonly baselineYear: number;
    readonly targetYear: number;
    readonly progress: number; // 0-1
  }>;
}

export interface GresbInputPack {
  readonly assessmentYear: number;
  readonly entity: string;
  readonly management: Readonly<{
    readonly leadership: number;       // 0-1
    readonly policies: number;
    readonly reporting: number;
    readonly riskManagement: number;
    readonly stakeholderEngagement: number;
  }>;
  readonly performanceByAssetClass: Readonly<Record<AssetClass, {
    readonly energyMWh: number;
    readonly ghgKgCO2e: KgCO2e;
    readonly waterM3: number;
    readonly wasteTonnes: number;
    readonly priorYearEnergyMWh: number;
    readonly priorYearGhgKgCO2e: KgCO2e;
    readonly bmsCoveragePct: number;
    readonly certifiedGfaPct: number;
  }>>;
}

// ─────────────────────────────────────────────────────────────────────
// Biodiversity
// ─────────────────────────────────────────────────────────────────────

/** Defra Biodiversity Metric 4.0 distinctiveness band. */
export type BngDistinctiveness =
  | 'V_HIGH'   // 8 pts
  | 'HIGH'     // 6
  | 'MEDIUM'   // 4
  | 'LOW'      // 2
  | 'V_LOW';   // 0

/** Habitat condition band. */
export type BngCondition = 'GOOD' | 'MODERATE' | 'POOR' | 'NA';

export interface BngHabitatParcel {
  readonly id: string;
  readonly habitatType: string;
  readonly area_ha: number;
  readonly distinctiveness: BngDistinctiveness;
  readonly condition: BngCondition;
  readonly strategicSignificance: 'WITHIN_LOCAL_STRATEGY' | 'LOCATION_DESIGNATED' | 'OUTSIDE';
}

export interface BngAssessment {
  readonly siteName: string;
  readonly baselineUnits: number;
  readonly postDevelopmentUnits: number;
  readonly netGainPct: number;
  readonly meetsLegalThreshold: boolean;   // ≥10% per Env Act 2021
  readonly offSiteUnitsRequired: number;
  readonly statutoryCreditCostGBP: number; // Defra Tier-A backstop
  readonly explainability: ReadonlyArray<string>;
}

export interface SbtnTargetSuggestion {
  readonly driver: 'land_use' | 'freshwater' | 'oceans' | 'climate' | 'pollution';
  readonly target: string;
  readonly horizon: number;       // years out
  readonly rationale: string;
}

export interface NbsOpportunity {
  readonly intervention: string;
  readonly area_m2_or_units: number;
  readonly capexEstimate: number;
  readonly currency: CurrencyCode;
  readonly annualSequestrationKgCO2e: KgCO2e;
  readonly biodiversityUpliftUnits: number;
  readonly stormwaterAttenuationLPerYr: number;
  readonly fitForClimate: boolean;
  readonly rationale: string;
}

// ─────────────────────────────────────────────────────────────────────
// Top-level reports
// ─────────────────────────────────────────────────────────────────────

export interface PropertyEsg {
  readonly property: PropertyDescriptor;
  readonly period: ReportingPeriod;
  readonly carbon: CarbonReport;
  readonly ratings: ReadonlyArray<GreenRating>;
  readonly euTaxonomy: EuTaxonomyAssessment | null;
  readonly biodiversity: BngAssessment | null;
  readonly nbsOpportunities: ReadonlyArray<NbsOpportunity>;
  readonly recommendedTargets: ReadonlyArray<SbtnTargetSuggestion>;
  readonly executiveSummary: string;
  readonly veteranAdvisorNotes: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Ports (injectable adapters)
// ─────────────────────────────────────────────────────────────────────

export interface CarbonPriceFeed {
  /** Mid-market spot in stated currency per tCO2e. */
  spot(standard: CreditStandard, currency: CurrencyCode): Promise<{
    readonly price: number;
    readonly asOf: string;
    readonly source: string;
  }>;
  /** Forward strip if available (key = tenor label). */
  forwards(standard: CreditStandard, currency: CurrencyCode): Promise<Readonly<Record<string, number>>>;
}

export interface GridIntensityFeed {
  /** Latest grid intensity for the requested country, kgCO2e/kWh. */
  latest(country: CountryCode): Promise<{
    readonly kgCO2ePerKWh: number;
    readonly asOf: string;
    readonly source: string;
  }>;
}
