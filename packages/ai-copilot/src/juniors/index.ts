/**
 * Borjie juniors barrel — every mining-domain specialist AI lives here.
 *
 * Two surfaces per junior:
 *   - `createXxxAgent(deps)` — explicit dependency injection. Use this
 *     in tests, in the JuniorAIFactory, or anywhere you want to wire a
 *     custom ClaudeClient / DrizzleClient / logger.
 *   - `createDefaultXxxAgent()` — lazy convenience. Reads
 *     ANTHROPIC_API_KEY + DATABASE_URL on first call. Returns an agent
 *     with the same `processInput(input)` surface.
 *
 * The Zod input + output schemas, the universal-envelope system prompt
 * constants, and any extra types are also re-exported per junior so
 * downstream code can validate at the orchestration boundary.
 *
 * The 28 juniors (27 scaffolded here + document-agent already present):
 *   document-agent             — PML PDF parser (already exists).
 *   master-brain               — dispatch router.
 *   auditor-agent              — evidence gate.
 *   licence-agent              — renewal calendar + dormancy score.
 *   drill-hole-logger          — structured drill / pit / shaft capture.
 *   lab-assay-agent            — sample chain-of-custody + QA/QC.
 *   geology-agent              — geology score + vein triangulation.
 *   mine-planner               — site layout + weekly plan.
 *   operations-sic-agent       — Short Interval Control loop.
 *   hr-agent                   — attendance + local-content compliance.
 *   asset-fleet-agent          — utilisation + service-due flags.
 *   maintenance-agent          — fuel + machine hours + downtime.
 *   procurement-agent          — reorder + supplier ITC compliance.
 *   cost-engineer              — unit economics + break-even.
 *   fx-treasury-agent          — FX + sell-vs-stockpile + USD cliff.
 *   sales-offtake-agent        — buyer comparison + MTC pre-flight.
 *   buyer-kyc-agent            — NIDA + TIN + AML check.
 *   marketplace-stakeholder-agent — discovery + ratings + translation.
 *   compliance-agent           — regulator citation lookup.
 *   safety-agent               — critical controls + incident heatmap.
 *   community-agent            — grievance tracking.
 *   village-csr-agent          — CSR delivery dashboard.
 *   contract-currency-auditor  — post-cliff USD-contract remediation.
 *   report-writer              — daily / weekly / monthly / pack writer.
 *   notifications-router       — push + SMS + WhatsApp + voice fan-out.
 *   metallurgy-agent           — processing flowsheet + recovery.
 *   forecast-modeler           — production + cash + cost forecasts.
 *   risk-modeler               — composite risk score.
 */

// ─────────────────────────────────────────────────────────────────────
// Shared
// ─────────────────────────────────────────────────────────────────────

export * from './_shared.js';

// ─────────────────────────────────────────────────────────────────────
// Existing document agent (untouched). `ClaudeClient` is intentionally
// re-exported only from `_shared.js` to avoid the duplicate-symbol
// error; consumers should rely on the `_shared` definition.
// ─────────────────────────────────────────────────────────────────────

export {
  CoordsSchema,
  createDocumentAgent,
  documentAgent,
  PMLExtractionSchema,
  type Coords,
  type DocumentAgent,
  type DocumentAgentDeps,
  type LicenceRow,
  type LicenceWriter,
  type PdfReader,
  type PMLExtraction,
  type ProcessPMLInput,
  type ProcessPMLResult,
  type TemporalEntityRow,
  type TemporalEntityWriter,
} from './document-agent.js';

// ─────────────────────────────────────────────────────────────────────
// Orchestrators
// ─────────────────────────────────────────────────────────────────────

export {
  createMasterBrainAgent,
  createDefaultMasterBrainAgent,
  MasterBrainInputSchema,
  MasterBrainOutputSchema,
  MasterBrainMode,
  JuniorName,
  MASTER_BRAIN_SYSTEM_PROMPT,
  type MasterBrainInput,
  type MasterBrainOutput,
  type MasterBrainAgent,
} from './master-brain.js';

export {
  createAuditorAgent,
  createDefaultAuditorAgent,
  AuditorInputSchema,
  AuditorOutputSchema,
  AuditorVerdict,
  RecommendationToAudit,
  AUDITOR_SYSTEM_PROMPT,
  type AuditorInput,
  type AuditorOutput,
  type AuditorAgent,
} from './auditor-agent.js';

// ─────────────────────────────────────────────────────────────────────
// Tenure & compliance
// ─────────────────────────────────────────────────────────────────────

export {
  createLicenceAgent,
  createDefaultLicenceAgent,
  LicenceAgentInputSchema,
  LicenceRenewalOutput,
  LicenceKindSchema,
  RenewalMilestone,
  LICENCE_AGENT_SYSTEM_PROMPT,
  type LicenceAgentInput,
  type LicenceAgent,
} from './licence-agent.js';

export {
  createComplianceAgent,
  createDefaultComplianceAgent,
  ComplianceInputSchema,
  ComplianceOutput,
  RegulatorBody,
  ProposedAction,
  Citation,
  COMPLIANCE_SYSTEM_PROMPT,
  type ComplianceInput,
  type ComplianceAgent,
} from './compliance-agent.js';

export {
  createContractCurrencyAuditor,
  createDefaultContractCurrencyAuditor,
  ContractCurrencyAuditorInputSchema,
  ContractCurrencyAuditorOutput,
  CONTRACT_CURRENCY_AUDITOR_SYSTEM_PROMPT,
  type ContractCurrencyAuditorInput,
  type ContractCurrencyAuditor,
} from './contract-currency-auditor.js';

// ─────────────────────────────────────────────────────────────────────
// Geology & lab
// ─────────────────────────────────────────────────────────────────────

export {
  createDrillHoleLogger,
  createDefaultDrillHoleLogger,
  DrillHoleInputSchema,
  DrillHoleOutput,
  HoleKindSchema,
  LayerInputSchema,
  GpsSchema,
  DRILL_HOLE_LOGGER_SYSTEM_PROMPT,
  type DrillHoleInput,
  type LayerInput,
  type DrillHoleLogger,
} from './drill-hole-logger.js';

export {
  createLabAssayAgent,
  createDefaultLabAssayAgent,
  LabAssayInputSchema,
  LabAssayOutput,
  LabId,
  SampleSchema,
  QaQcFailure,
  LAB_ASSAY_SYSTEM_PROMPT,
  type LabAssayInput,
  type Sample,
  type LabAssayAgent,
} from './lab-assay-agent.js';

export {
  createGeologyAgent,
  createDefaultGeologyAgent,
  GeologyAgentInputSchema,
  GeologyAgentOutput,
  VeinIntersect,
  GEOLOGY_AGENT_SYSTEM_PROMPT,
  type GeologyAgentInput,
  type GeologyAgent,
} from './geology-agent.js';

export {
  createMetallurgyAgent,
  createDefaultMetallurgyAgent,
  MetallurgyInputSchema,
  MetallurgyOutput,
  MineralFamily,
  FlowsheetStep,
  METALLURGY_SYSTEM_PROMPT,
  type MetallurgyInput,
  type MetallurgyAgent,
} from './metallurgy-agent.js';

// ─────────────────────────────────────────────────────────────────────
// Planning & operations
// ─────────────────────────────────────────────────────────────────────

export {
  createMinePlanner,
  createDefaultMinePlanner,
  MinePlannerInputSchema,
  MinePlannerOutput,
  PolygonPoint,
  FleetItem,
  SiteSection,
  MINE_PLANNER_SYSTEM_PROMPT,
  type MinePlannerInput,
  type MinePlanner,
} from './mine-planner.js';

export {
  createOperationsSicAgent,
  createDefaultOperationsSicAgent,
  OperationsInputSchema,
  OperationsOutput,
  DeviationCode,
  OPERATIONS_SIC_SYSTEM_PROMPT,
  type OperationsInput,
  type OperationsSicAgent,
} from './operations-sic-agent.js';

// ─────────────────────────────────────────────────────────────────────
// People, assets, supply chain
// ─────────────────────────────────────────────────────────────────────

export {
  createHrAgent,
  createDefaultHrAgent,
  HrAgentInputSchema,
  HrAgentOutput,
  Employee,
  Phase,
  HR_AGENT_SYSTEM_PROMPT,
  type HrAgentInput,
  type HrAgent,
} from './hr-agent.js';

export {
  createAssetFleetAgent,
  createDefaultAssetFleetAgent,
  AssetFleetInputSchema,
  AssetFleetOutput,
  AssetKind,
  AssetSchema,
  ASSET_FLEET_SYSTEM_PROMPT,
  type AssetFleetInput,
  type AssetFleetAgent,
} from './asset-fleet-agent.js';

export {
  createMaintenanceAgent,
  createDefaultMaintenanceAgent,
  MaintenanceInputSchema,
  MaintenanceOutput,
  FuelLog,
  DowntimeEvent,
  MAINTENANCE_SYSTEM_PROMPT,
  type MaintenanceInput,
  type MaintenanceAgent,
} from './maintenance-agent.js';

export {
  createProcurementAgent,
  createDefaultProcurementAgent,
  ProcurementInputSchema,
  ProcurementOutput,
  InventoryItem,
  SupplierSchema,
  PROCUREMENT_SYSTEM_PROMPT,
  type ProcurementInput,
  type ProcurementAgent,
} from './procurement-agent.js';

// ─────────────────────────────────────────────────────────────────────
// Financial
// ─────────────────────────────────────────────────────────────────────

export {
  createCostEngineerAgent,
  createDefaultCostEngineerAgent,
  CostEngineerInputSchema,
  CostEngineerOutput,
  CostBucket,
  COST_ENGINEER_SYSTEM_PROMPT,
  type CostEngineerInput,
  type CostEngineerAgent,
} from './cost-engineer.js';

export {
  createFxTreasuryAgent,
  createDefaultFxTreasuryAgent,
  FxTreasuryInputSchema,
  FxTreasuryOutput,
  FxTreasuryMode,
  FX_TREASURY_SYSTEM_PROMPT,
  type FxTreasuryInput,
  type FxTreasuryAgent,
} from './fx-treasury-agent.js';

export {
  createSalesOfftakeAgent,
  createDefaultSalesOfftakeAgent,
  SalesInputSchema,
  SalesOutput,
  BuyerSchema,
  ParcelSchema,
  SALES_SYSTEM_PROMPT,
  type SalesInput,
  type SalesOfftakeAgent,
} from './sales-offtake-agent.js';

export {
  createBuyerKycAgent,
  createDefaultBuyerKycAgent,
  BuyerKycInputSchema,
  BuyerKycOutput,
  BUYER_KYC_SYSTEM_PROMPT,
  type BuyerKycInput,
  type BuyerKycAgent,
} from './buyer-kyc-agent.js';

// ─────────────────────────────────────────────────────────────────────
// Community, safety & marketplace
// ─────────────────────────────────────────────────────────────────────

export {
  createSafetyAgent,
  createDefaultSafetyAgent,
  SafetyAgentInputSchema,
  SafetyAgentOutput,
  IncidentKind,
  Severity,
  IncidentRecord,
  PpeIssue,
  SAFETY_SYSTEM_PROMPT,
  type SafetyAgentInput,
  type SafetyAgent,
} from './safety-agent.js';

export {
  createCommunityAgent,
  createDefaultCommunityAgent,
  CommunityInputSchema,
  CommunityOutput,
  Grievance,
  GrievanceKind,
  COMMUNITY_SYSTEM_PROMPT,
  type CommunityInput,
  type CommunityAgent,
} from './community-agent.js';

export {
  createVillageCsrAgent,
  createDefaultVillageCsrAgent,
  VillageCsrInputSchema,
  VillageCsrOutput,
  CsrCommitment,
  CsrProjectKind,
  VILLAGE_CSR_SYSTEM_PROMPT,
  type VillageCsrInput,
  type VillageCsrAgent,
} from './village-csr-agent.js';

export {
  createMarketplaceStakeholderAgent,
  createDefaultMarketplaceStakeholderAgent,
  MarketplaceInputSchema,
  MarketplaceOutput,
  ParticipantKind,
  MARKETPLACE_SYSTEM_PROMPT,
  type MarketplaceInput,
  type MarketplaceStakeholderAgent,
} from './marketplace-stakeholder-agent.js';

// ─────────────────────────────────────────────────────────────────────
// Reporting, notifications, forecasting, risk
// ─────────────────────────────────────────────────────────────────────

export {
  createReportWriter,
  createDefaultReportWriter,
  ReportWriterInputSchema,
  ReportWriterOutput,
  ReportCadence,
  REPORT_WRITER_SYSTEM_PROMPT,
  type ReportWriterInput,
  type ReportWriter,
} from './report-writer.js';

export {
  createNotificationsRouter,
  createDefaultNotificationsRouter,
  NotificationsRouterInputSchema,
  NotificationsRouterOutput,
  NotificationCategory,
  Channel,
  NOTIFICATIONS_ROUTER_SYSTEM_PROMPT,
  type NotificationsRouterInput,
  type NotificationsRouter,
} from './notifications-router.js';

export {
  createForecastModeler,
  createDefaultForecastModeler,
  ForecastModelerInputSchema,
  ForecastModelerOutput,
  ForecastKind,
  ScenarioSeries,
  FORECAST_MODELER_SYSTEM_PROMPT,
  type ForecastModelerInput,
  type ForecastModeler,
} from './forecast-modeler.js';

export {
  createRiskModeler,
  createDefaultRiskModeler,
  RiskModelerInputSchema,
  RiskModelerOutput,
  RiskCategory,
  RiskFactor,
  RISK_MODELER_SYSTEM_PROMPT,
  type RiskModelerInput,
  type RiskModeler,
} from './risk-modeler.js';
