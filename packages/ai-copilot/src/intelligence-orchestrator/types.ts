/**
 * Intelligence Orchestrator Types (BORJIE port of LitFin types)
 *
 * Central type definitions for the unified estate-management intelligence
 * layer. Connects maintenance + payments + compliance + leasing + inspection
 * + FAR into a single decision context so the Brain can explain WHY a unit
 * is trending a certain way, not just report it.
 *
 * All types are readonly-friendly and tenant-scoped.
 *
 * @module intelligence-orchestrator/types
 */

// ============================================================================
// Unified Estate Decision Context
// ============================================================================

export interface UnifiedEstateContext {
  readonly scopeKind: 'property' | 'unit' | 'tenant' | 'portfolio';
  readonly scopeId: string;
  readonly tenantId: string;
  readonly generatedAt: Date;
  readonly processingTimeMs: number;

  readonly payments: PaymentsSnapshot | null;
  readonly maintenance: MaintenanceSnapshot | null;
  readonly compliance: ComplianceSnapshot | null;
  readonly leasing: LeasingSnapshot | null;
  readonly inspection: InspectionSnapshot | null;
  readonly far: FARSnapshot | null;
  readonly tenantRisk: TenantRiskSnapshot | null;
  readonly occupancy: OccupancySnapshot | null;

  readonly crossModuleInsights: readonly CrossModuleInsight[];
  readonly proactiveAlerts: readonly ProactiveAlert[];
  readonly overallConfidence: number;
  readonly synthesizedRecommendation: SynthesizedRecommendation;
}

// ============================================================================
// Module Snapshots
// ============================================================================

export interface PaymentsSnapshot {
  readonly totalInvoicedCents: number;
  readonly totalPaidCents: number;
  readonly arrearsCents: number;
  readonly arrearsBuckets: Record<'0_30' | '31_60' | '61_90' | '91_plus', number>;
  readonly avgDaysLateTrend30d: number;
  readonly consecutiveLateMonths: number;
  readonly computedAt: string;
}

export interface MaintenanceSnapshot {
  readonly openCases: number;
  readonly criticalCases: number;
  readonly avgResolutionDays: number;
  readonly costLast90dCents: number;
  readonly costMomYoYPct: number;
  readonly topCategories: ReadonlyArray<{ category: string; count: number }>;
  readonly repeatCaseRate: number;
  readonly computedAt: string;
}

export interface ComplianceSnapshot {
  readonly openItems: number;
  readonly overdueItems: number;
  readonly criticalBreaches: number;
  readonly lastInspectionDate: string | null;
  readonly pendingNoticesToTenants: number;
  readonly pendingRegulatorFilings: number;
}

export interface LeasingSnapshot {
  readonly leaseEndWithin60d: number;
  readonly pendingRenewals: number;
  readonly churnProbability: number; // 0-1
  readonly avgRentVsMarketPct: number;
  readonly vacancyWaterfall30d: number;
}

export interface InspectionSnapshot {
  readonly overdueInspections: number;
  readonly lastInspectionScore: number | null;
  readonly failedItems: number;
}

export interface FARSnapshot {
  readonly assetsUnderService: number;
  readonly assetsNearingEOL: number;
  readonly totalReplacementCostCents: number;
  readonly depreciatedValueCents: number;
}

export interface TenantRiskSnapshot {
  readonly riskGrade: 'A' | 'B' | 'C' | 'D' | 'E';
  readonly riskScore: number; // 0-100
  readonly disputeCount: number;
  readonly complaintsLast90d: number;
  readonly paymentReliabilityPct: number; // 0-100
}

export interface OccupancySnapshot {
  readonly occupancyPct: number;
  readonly vacancyCount: number;
  readonly avgVacancyDays: number;
  readonly timeOnMarketDays: number;
}

// ============================================================================
// Cross-Module Intelligence
// ============================================================================

export interface CrossModuleInsight {
  readonly id: string;
  readonly type: CrossModuleInsightType;
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly title: string;
  readonly description: string;
  readonly sourceModules: readonly string[];
  readonly confidence: number;
  readonly actionable: boolean;
  readonly suggestedAction?: string;
}

export type CrossModuleInsightType =
  | 'arrears_rising_with_maintenance_cost_spike'
  | 'vacancy_dip_with_tenant_churn'
  | 'compliance_breach_on_high_risk_tenant'
  | 'repeat_maintenance_with_rent_concession'
  | 'lease_end_with_open_compliance'
  | 'far_aging_with_rising_maintenance'
  | 'inspection_fail_with_no_followup'
  | 'tenant_complaint_surge_with_churn_risk'
  | 'district_arrears_concentration'
  | 'gepg_reconciliation_drift';

// ============================================================================
// Proactive Alerts
// ============================================================================

export interface ProactiveAlert {
  readonly id: string;
  readonly priority: 1 | 2 | 3;
  readonly category: AlertCategory;
  readonly title: string;
  readonly message: string;
  readonly evidenceRefs: readonly string[];
  readonly actionPlan: readonly string[];
  readonly dataPoints: Record<string, unknown>;
  readonly requiresOperatorAction: boolean;
}

export type AlertCategory =
  | 'arrears_escalation'
  | 'maintenance_cost'
  | 'compliance_breach'
  | 'occupancy_dip'
  | 'tenant_churn'
  | 'far_degradation'
  | 'inspection_gap'
  | 'portfolio_concentration'
  | 'regulatory_filing'
  | 'gepg_reconciliation'
  | 'data_quality';

// ============================================================================
// Synthesized Recommendation
// ============================================================================

export interface SynthesizedRecommendation {
  readonly action:
    | 'ok'
    | 'monitor'
    | 'intervene'
    | 'escalate_to_manager'
    | 'insufficient_data';
  readonly confidence: number;
  readonly rationale: readonly string[];
  readonly conditions: readonly string[];
  readonly riskFactors: readonly string[];
  readonly mitigatingFactors: readonly string[];
  readonly dissenting: readonly string[];
}

// ============================================================================
// Orchestrator Configuration
// ============================================================================

export interface IntelligenceOrchestratorConfig {
  readonly enableCrossModuleReasoning: boolean;
  readonly enableProactiveAlerts: boolean;
  readonly enableFeedbackCapture: boolean;
  readonly timeoutMs: number;
  readonly alertConfidenceThreshold: number;
}

export const DEFAULT_INTELLIGENCE_CONFIG: IntelligenceOrchestratorConfig =
  Object.freeze({
    enableCrossModuleReasoning: true,
    enableProactiveAlerts: true,
    enableFeedbackCapture: true,
    timeoutMs: 10000,
    alertConfidenceThreshold: 0.5,
  });
