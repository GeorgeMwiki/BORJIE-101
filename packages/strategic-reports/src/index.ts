/**
 * `@borjie/strategic-reports` — public surface.
 *
 * Three things consumers need:
 *
 *   1. The engine — `createReportEngine({ ... })` + `generateReport(...)`
 *   2. The types — `ReportSpec`, `StrategicReport`, `RenderedReport`, ...
 *   3. The building blocks — gatherers, the persona builder, the
 *      template render fns. Consumers that want a custom pipeline
 *      (e.g. swap the composer, run only the gather stage from a CLI)
 *      can compose these directly.
 *
 * No I/O is performed at import time. Every advisor / brain / studio /
 * audit / store port is injected.
 */

// ── Engine ────────────────────────────────────────────────────────────────
export {
  createReportEngine,
  generateReport,
  collectReportText,
  orgIdFromScope,
  type ReportEngine,
  type ReportEngineDeps,
  type RenderedReport,
  type GenerateReportArgs,
} from './renderer.js';

// ── Types ─────────────────────────────────────────────────────────────────
export {
  REPORT_TYPES,
  REPORT_FORMATS,
  REPORT_AUDIENCES,
  REPORT_DEPTHS,
  REPORT_JURISDICTIONS,
  PAGE_BUDGET,
  EXECUTIVE_SUMMARY_WORD_LIMIT,
  MIN_ACTION_PLAN_ITEMS,
  ReportSpecSchema,
  CitationSchema,
  isReportType,
  countWords,
  runStructuralQualityGates,
  ok,
  err,
  type ActionItem,
  type ActionPriority,
  type AuditEntry,
  type AuditPort,
  type BrainPort,
  type BrainSynthesizeArgs,
  type BrainSynthesizeResult,
  type ChartSeries,
  type ChartSpec,
  type Citation,
  type CitationVerifierPort,
  type Composer,
  type ComposerContext,
  type DocumentStudioPort,
  type EvidenceFragment,
  type EvidencePack,
  type Gatherer,
  type GathererContext,
  type PersistedReport,
  type QualityGateViolation,
  type RenderRequest,
  type RenderedReportArtifact,
  type ReportAudience,
  type ReportDepth,
  type ReportEngineError,
  type ReportEngineErrorCode,
  type ReportEngineResult,
  type ReportFormat,
  type ReportJurisdiction,
  type ReportPeriod,
  type ReportScope,
  type ReportSection,
  type ReportSpec,
  type ReportStore,
  type ReportStoreListFilters,
  type ReportType,
  type StrategicReport,
  type TableSpec,
} from './types.js';

// ── Gatherers + advisor ports ─────────────────────────────────────────────
export {
  createLeasingFinancialGatherer,
  createConditionalSurveyGatherer,
  createAcquisitionIcGatherer,
  createDispositionGatherer,
  createRefinancingGatherer,
  createSustainabilityGatherer,
  createExpansionStrategyGatherer,
  createTenantCreditGatherer,
  createRentRollGatherer,
  createAnnualOperatingReviewGatherer,
  gathererFor,
  type AdvisorPorts,
  type AcquisitionAdvisorPort,
  type AcquisitionDeal,
  type ConditionalSurveyPort,
  type DispositionThesis,
  type ExpansionAdvisorPort,
  type ExpansionRecommendation,
  type GreenAngleAdvisorPort,
  type GreenAngleSummary,
  type LeasingFinancialPort,
  type LifecycleAdvisorPort,
  type MoneyAmount,
  type OccupancyLine,
  type RefinancingProposal,
  type RentRollEntry,
  type RentRollPort,
  type RevenueLine,
  type SurveyDefect,
  type SurveySnapshot,
  type SustainabilityAdvisorPort,
  type SustainabilitySnapshot,
  type TenantContextPort,
  type TenantContextProfile,
} from './gatherers/index.js';

// ── Composers ─────────────────────────────────────────────────────────────
export {
  composerFor,
  runComposer,
  buildUserPrompt,
  parseSections,
  buildCitations,
  BLUEPRINT_FOR,
  LEASING_FINANCIAL_BLUEPRINT,
  CONDITIONAL_SURVEY_BLUEPRINT,
  ACQUISITION_IC_BLUEPRINT,
  DISPOSITION_BLUEPRINT,
  REFINANCING_BLUEPRINT,
  SUSTAINABILITY_BLUEPRINT,
  EXPANSION_BLUEPRINT,
  TENANT_CREDIT_BLUEPRINT,
  RENT_ROLL_BLUEPRINT,
  AOR_BLUEPRINT,
  type ComposerBlueprint,
  type SectionBlueprint,
  type RunComposerArgs,
} from './composers/index.js';

// ── Persona ───────────────────────────────────────────────────────────────
export {
  buildHarvardPhdPersona,
  EVIDENCE_NORMS_PARAGRAPH,
  DISCIPLINE_PREFIX_LITERAL,
  type PersonaArgs,
} from './personas/harvard-phd-persona.js';

// ── Template render fns ───────────────────────────────────────────────────
export {
  buildHtmlSource,
  buildTypstSource,
  buildCarboneBinding,
  bindTemplate,
  type CarboneBinding,
  type CarboneContext,
} from './templates/index.js';
