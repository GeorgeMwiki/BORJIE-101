/**
 * Intelligence Orchestrator Service — facade tying modules together.
 *
 * Fetches module snapshots in parallel, runs cross-module reasoning,
 * generates proactive alerts, and produces a synthesized recommendation.
 *
 * Exposed via `createIntelligenceOrchestrator(deps)`.
 *
 * @module intelligence-orchestrator/orchestrator-service
 */

import {
  DEFAULT_INTELLIGENCE_CONFIG,
  type UnifiedEstateContext,
  type IntelligenceOrchestratorConfig,
  type PaymentsSnapshot,
  type MaintenanceSnapshot,
  type ComplianceSnapshot,
  type LeasingSnapshot,
  type InspectionSnapshot,
  type FARSnapshot,
  type TenantRiskSnapshot,
  type OccupancySnapshot,
  type CrossModuleInsight,
  type SynthesizedRecommendation,
} from './types.js';
import type { ModuleDataFetchers } from './module-fetchers.js';
import { generateCrossModuleInsights } from './cross-module-reasoner.js';
import { generateProactiveAlerts } from './proactive-alert-engine.js';

export interface OrchestratorDeps {
  readonly fetchers: ModuleDataFetchers;
  readonly config?: Partial<IntelligenceOrchestratorConfig>;
}

export class IntelligenceOrchestrator {
  private readonly config: IntelligenceOrchestratorConfig;
  private readonly fetchers: ModuleDataFetchers;

  constructor(deps: OrchestratorDeps) {
    this.config = { ...DEFAULT_INTELLIGENCE_CONFIG, ...(deps.config ?? {}) };
    this.fetchers = deps.fetchers;
  }

  async generateContext(input: {
    scopeKind: 'property' | 'unit' | 'tenant' | 'portfolio';
    scopeId: string;
    tenantId: string;
  }): Promise<UnifiedEstateContext> {
    assertTenant(input.tenantId);
    const start = performance.now();

    const [
      payments,
      maintenance,
      compliance,
      leasing,
      inspection,
      far,
      tenantRisk,
      occupancy,
    ] = await Promise.all([
      this.safe(() => this.fetchers.fetchPayments(input.scopeKind, input.scopeId, input.tenantId)),
      this.safe(() => this.fetchers.fetchMaintenance(input.scopeKind, input.scopeId, input.tenantId)),
      this.safe(() => this.fetchers.fetchCompliance(input.scopeKind, input.scopeId, input.tenantId)),
      this.safe(() => this.fetchers.fetchLeasing(input.scopeKind, input.scopeId, input.tenantId)),
      this.safe(() => this.fetchers.fetchInspection(input.scopeKind, input.scopeId, input.tenantId)),
      this.safe(() => this.fetchers.fetchFAR(input.scopeKind, input.scopeId, input.tenantId)),
      this.safe(() => this.fetchers.fetchTenantRisk(input.scopeKind, input.scopeId, input.tenantId)),
      this.safe(() => this.fetchers.fetchOccupancy(input.scopeKind, input.scopeId, input.tenantId)),
    ]);

    const crossModuleInsights = this.config.enableCrossModuleReasoning
      ? generateCrossModuleInsights({
          payments,
          maintenance,
          compliance,
          leasing,
          inspection,
          far,
          tenantRisk,
          occupancy,
        })
      : [];

    const proactiveAlerts = this.config.enableProactiveAlerts
      ? generateProactiveAlerts(
          {
            payments,
            maintenance,
            compliance,
            leasing,
            inspection,
            tenantRisk,
            occupancy,
            crossModuleInsights,
          },
          this.config.alertConfidenceThreshold,
        )
      : [];

    const synthesizedRecommendation = synthesizeRecommendation({
      payments,
      maintenance,
      compliance,
      leasing,
      tenantRisk,
      occupancy,
      crossModuleInsights,
    });

    const overallConfidence = computeOverallConfidence({
      payments,
      maintenance,
      compliance,
      leasing,
      occupancy,
    });

    return {
      scopeKind: input.scopeKind,
      scopeId: input.scopeId,
      tenantId: input.tenantId,
      generatedAt: new Date(),
      processingTimeMs: performance.now() - start,
      payments,
      maintenance,
      compliance,
      leasing,
      inspection,
      far,
      tenantRisk,
      occupancy,
      crossModuleInsights,
      proactiveAlerts,
      overallConfidence,
      synthesizedRecommendation,
    };
  }

  private async safe<T>(
    fn: () => Promise<T | null>,
  ): Promise<T | null> {
    try {
      return await Promise.race([
        fn(),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), this.config.timeoutMs),
        ),
      ]);
    } catch {
      return null;
    }
  }
}

// ============================================================================
// Synthesis
// ============================================================================

interface SynthesisInput {
  payments: PaymentsSnapshot | null;
  maintenance: MaintenanceSnapshot | null;
  compliance: ComplianceSnapshot | null;
  leasing: LeasingSnapshot | null;
  tenantRisk: TenantRiskSnapshot | null;
  occupancy: OccupancySnapshot | null;
  crossModuleInsights: readonly CrossModuleInsight[];
}

function synthesizeRecommendation(
  input: SynthesisInput,
): SynthesizedRecommendation {
  const rationale: string[] = [];
  const conditions: string[] = [];
  const riskFactors: string[] = [];
  const mitigatingFactors: string[] = [];
  const dissenting: string[] = [];

  let interveneSignals = 0;
  let okSignals = 0;

  if (input.payments) {
    if (input.payments.arrearsCents > 0) {
      interveneSignals += input.payments.consecutiveLateMonths >= 2 ? 2 : 1;
      riskFactors.push(
        `Arrears ${(input.payments.arrearsCents / 100).toLocaleString()} with ${input.payments.consecutiveLateMonths} consecutive late months`,
      );
    } else {
      okSignals += 1;
      mitigatingFactors.push('No current arrears');
    }
  }
  if (input.maintenance && input.maintenance.criticalCases > 0) {
    interveneSignals += 1;
    riskFactors.push(
      `${input.maintenance.criticalCases} critical maintenance case(s) open`,
    );
  }
  if (input.compliance && input.compliance.criticalBreaches > 0) {
    interveneSignals += 2;
    riskFactors.push(
      `${input.compliance.criticalBreaches} critical compliance breach(es)`,
    );
  }
  if (input.leasing && input.leasing.churnProbability > 0.6) {
    interveneSignals += 1;
    riskFactors.push(
      `Churn probability ${(input.leasing.churnProbability * 100).toFixed(0)}%`,
    );
    conditions.push('Launch retention outreach');
  }
  if (input.occupancy && input.occupancy.occupancyPct < 85) {
    interveneSignals += 1;
    riskFactors.push(
      `Occupancy ${input.occupancy.occupancyPct.toFixed(0)}% below 85% target`,
    );
  }

  const critical = input.crossModuleInsights.filter(
    (i) => i.severity === 'critical',
  );
  const high = input.crossModuleInsights.filter((i) => i.severity === 'high');
  if (critical.length > 0) {
    interveneSignals += 2;
    riskFactors.push(...critical.map((c) => c.title));
  }
  if (high.length > 0) {
    interveneSignals += 1;
    conditions.push(...high.map((h) => h.suggestedAction ?? h.title));
  }

  if (okSignals > 0 && interveneSignals > 0) {
    dissenting.push(
      `Mixed signals: ${okSignals} positive vs ${interveneSignals} intervention indicators`,
    );
  }

  let action: SynthesizedRecommendation['action'];
  if (interveneSignals >= 5 || critical.length >= 2) {
    action = 'escalate_to_manager';
  } else if (interveneSignals >= 3) {
    action = 'intervene';
  } else if (interveneSignals >= 1) {
    action = 'monitor';
  } else if (okSignals === 0 && interveneSignals === 0) {
    action = 'insufficient_data';
  } else {
    action = 'ok';
  }

  if (!input.payments && !input.maintenance && !input.compliance) {
    action = 'insufficient_data';
    rationale.push('Payments, maintenance, and compliance all unavailable');
  } else {
    rationale.push(
      `Intervention signals: ${interveneSignals}; OK signals: ${okSignals}`,
    );
  }

  const totalSignals = Math.max(1, interveneSignals + okSignals);
  const confidence =
    action === 'insufficient_data'
      ? 0.2
      : Math.min(0.95, Math.max(interveneSignals, okSignals) / totalSignals);

  return {
    action,
    confidence,
    rationale,
    conditions,
    riskFactors,
    mitigatingFactors,
    dissenting,
  };
}

function computeOverallConfidence(input: {
  payments: PaymentsSnapshot | null;
  maintenance: MaintenanceSnapshot | null;
  compliance: ComplianceSnapshot | null;
  leasing: LeasingSnapshot | null;
  occupancy: OccupancySnapshot | null;
}): number {
  let confidence = 0;
  let weight = 0;

  if (input.payments) {
    confidence += 0.85 * 0.3;
    weight += 0.3;
  }
  if (input.maintenance) {
    confidence += 0.8 * 0.2;
    weight += 0.2;
  }
  if (input.compliance) {
    confidence += 0.85 * 0.2;
    weight += 0.2;
  }
  if (input.leasing) {
    confidence += 0.75 * 0.15;
    weight += 0.15;
  }
  if (input.occupancy) {
    confidence += 0.75 * 0.15;
    weight += 0.15;
  }
  return weight > 0 ? confidence / weight : 0.1;
}

function assertTenant(tenantId: string): void {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new Error('intelligence-orchestrator: tenantId is required');
  }
}

export function createIntelligenceOrchestrator(
  deps: OrchestratorDeps,
): IntelligenceOrchestrator {
  return new IntelligenceOrchestrator(deps);
}
