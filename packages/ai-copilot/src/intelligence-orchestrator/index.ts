/**
 * Intelligence Orchestrator — public surface.
 *
 * BORJIE port of LitFin's intelligence-orchestrator, translated from
 * lending to estate management. Ties together module fetchers, cross-module
 * reasoning, proactive alerts, portfolio early-warning, operator-feedback
 * learning, LLM-free routing, and cross-persona memory.
 *
 * @module intelligence-orchestrator
 */

export {
  IntelligenceOrchestrator,
  createIntelligenceOrchestrator,
  type OrchestratorDeps,
} from './orchestrator-service.js';
export { generateCrossModuleInsights } from './cross-module-reasoner.js';
export { generateProactiveAlerts } from './proactive-alert-engine.js';
export {
  runPortfolioHealthCheck,
  formatAlertsForStorage,
  DEFAULT_WARNING_CONFIG,
  type PortfolioHealthCheck,
  type PortfolioAlert,
  type PortfolioAlertCategory,
  type PortfolioMetrics,
  type ConcentrationMetric,
  type EarlyWarningConfig,
  type PortfolioFeed,
} from './portfolio-early-warning.js';
export {
  DecisionFeedbackService,
  createDecisionFeedbackService,
  InMemoryDecisionFeedbackRepository,
  type DecisionFeedbackRecord,
  type DecisionFeedbackRepository,
  type OperatorVerdict,
  type OverrideStatistics,
} from './decision-feedback-service.js';
export {
  routeAdminQuery,
  DEFAULT_ROUTING_CONFIG,
  type RoutingDecision,
  type RoutingDestination,
  type RoutingConfig,
} from './intelligent-routing.js';
export {
  CrossPersonaMemoryService,
  createCrossPersonaMemoryService,
  InMemoryCrossPersonaRepository,
  type CrossPersonaMemoryRepository,
  type MemoryFact,
} from './cross-application-memory.js';
export {
  getRegionalEstateProfile,
  getRegionalEstateContext,
  recordEstateOutcome,
  type RegionalEstateProfile,
  type RegionalCreditContext,
  type EstateOutcomeRecord,
  type RegionalOutcomeRepository,
  type CountryCode,
} from './regional-estate-learning.js';
export { createMockFetchers, type MockSnapshots } from './module-fetchers.js';
export {
  enrichTurnWithIntelligence,
  captureProposedActionFeedback,
  type BrainTurnLike,
  type EnrichInput,
  type EnrichedTurn,
  type CaptureFeedbackInput,
} from './brain-adapter.js';
export type { ModuleDataFetchers } from './module-fetchers.js';
export type {
  UnifiedEstateContext,
  PaymentsSnapshot,
  MaintenanceSnapshot,
  ComplianceSnapshot,
  LeasingSnapshot,
  InspectionSnapshot,
  FARSnapshot,
  TenantRiskSnapshot,
  OccupancySnapshot,
  CrossModuleInsight,
  CrossModuleInsightType,
  ProactiveAlert,
  AlertCategory,
  SynthesizedRecommendation,
  IntelligenceOrchestratorConfig,
} from './types.js';
export { DEFAULT_INTELLIGENCE_CONFIG } from './types.js';
