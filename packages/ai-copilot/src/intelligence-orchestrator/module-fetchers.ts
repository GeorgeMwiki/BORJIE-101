/**
 * Module Data Fetchers — interface + in-memory mock.
 *
 * Typed fetchers for each Borjie domain. Each fetcher is tenant-scoped
 * and returns a null-safe snapshot consumable by the orchestrator.
 *
 * Real implementations bridge to domain-services (arrears, maintenance,
 * compliance, offtake, inspection, FAR, tenant-risk, production). A mock
 * implementation is provided for tests and local-dev bootstrapping.
 *
 * @module intelligence-orchestrator/module-fetchers
 */

import type {
  PaymentsSnapshot,
  MaintenanceSnapshot,
  ComplianceSnapshot,
  OfftakeSnapshot,
  InspectionSnapshot,
  FARSnapshot,
  CounterpartyRiskSnapshot,
  ProductionSnapshot,
} from './types.js';

export interface ModuleDataFetchers {
  fetchPayments(
    scopeKind: string,
    scopeId: string,
    tenantId: string,
  ): Promise<PaymentsSnapshot | null>;
  fetchMaintenance(
    scopeKind: string,
    scopeId: string,
    tenantId: string,
  ): Promise<MaintenanceSnapshot | null>;
  fetchCompliance(
    scopeKind: string,
    scopeId: string,
    tenantId: string,
  ): Promise<ComplianceSnapshot | null>;
  fetchOfftake(
    scopeKind: string,
    scopeId: string,
    tenantId: string,
  ): Promise<OfftakeSnapshot | null>;
  fetchInspection(
    scopeKind: string,
    scopeId: string,
    tenantId: string,
  ): Promise<InspectionSnapshot | null>;
  fetchFAR(
    scopeKind: string,
    scopeId: string,
    tenantId: string,
  ): Promise<FARSnapshot | null>;
  fetchCounterpartyRisk(
    scopeKind: string,
    scopeId: string,
    tenantId: string,
  ): Promise<CounterpartyRiskSnapshot | null>;
  fetchProduction(
    scopeKind: string,
    scopeId: string,
    tenantId: string,
  ): Promise<ProductionSnapshot | null>;
}

// ============================================================================
// Mock fetchers for tests / local-dev
// ============================================================================

export interface MockSnapshots {
  readonly payments?: Partial<PaymentsSnapshot> | null;
  readonly maintenance?: Partial<MaintenanceSnapshot> | null;
  readonly compliance?: Partial<ComplianceSnapshot> | null;
  readonly offtake?: Partial<OfftakeSnapshot> | null;
  readonly inspection?: Partial<InspectionSnapshot> | null;
  readonly far?: Partial<FARSnapshot> | null;
  readonly counterpartyRisk?: Partial<CounterpartyRiskSnapshot> | null;
  readonly production?: Partial<ProductionSnapshot> | null;
}

export function createMockFetchers(snapshots: MockSnapshots): ModuleDataFetchers {
  const p = snapshots.payments;
  const m = snapshots.maintenance;
  const c = snapshots.compliance;
  const l = snapshots.offtake;
  const i = snapshots.inspection;
  const f = snapshots.far;
  const t = snapshots.counterpartyRisk;
  const o = snapshots.production;

  return {
    async fetchPayments() {
      return p === null ? null : p ? buildPayments(p) : null;
    },
    async fetchMaintenance() {
      return m === null ? null : m ? buildMaintenance(m) : null;
    },
    async fetchCompliance() {
      return c === null ? null : c ? buildCompliance(c) : null;
    },
    async fetchOfftake() {
      return l === null ? null : l ? buildOfftake(l) : null;
    },
    async fetchInspection() {
      return i === null ? null : i ? buildInspection(i) : null;
    },
    async fetchFAR() {
      return f === null ? null : f ? buildFAR(f) : null;
    },
    async fetchCounterpartyRisk() {
      return t === null ? null : t ? buildCounterpartyRisk(t) : null;
    },
    async fetchProduction() {
      return o === null ? null : o ? buildProduction(o) : null;
    },
  };
}

function buildPayments(p: Partial<PaymentsSnapshot>): PaymentsSnapshot {
  return {
    totalInvoicedCents: p.totalInvoicedCents ?? 0,
    totalPaidCents: p.totalPaidCents ?? 0,
    arrearsCents: p.arrearsCents ?? 0,
    arrearsBuckets: p.arrearsBuckets ?? {
      '0_30': 0,
      '31_60': 0,
      '61_90': 0,
      '91_plus': 0,
    },
    avgDaysLateTrend30d: p.avgDaysLateTrend30d ?? 0,
    consecutiveLateMonths: p.consecutiveLateMonths ?? 0,
    computedAt: p.computedAt ?? new Date().toISOString(),
  };
}

function buildMaintenance(m: Partial<MaintenanceSnapshot>): MaintenanceSnapshot {
  return {
    openCases: m.openCases ?? 0,
    criticalCases: m.criticalCases ?? 0,
    avgResolutionDays: m.avgResolutionDays ?? 0,
    costLast90dCents: m.costLast90dCents ?? 0,
    costMomYoYPct: m.costMomYoYPct ?? 0,
    topCategories: m.topCategories ?? [],
    repeatCaseRate: m.repeatCaseRate ?? 0,
    computedAt: m.computedAt ?? new Date().toISOString(),
  };
}

function buildCompliance(c: Partial<ComplianceSnapshot>): ComplianceSnapshot {
  return {
    openItems: c.openItems ?? 0,
    overdueItems: c.overdueItems ?? 0,
    criticalBreaches: c.criticalBreaches ?? 0,
    lastInspectionDate: c.lastInspectionDate ?? null,
    pendingNoticesToCounterparties: c.pendingNoticesToCounterparties ?? 0,
    pendingRegulatorFilings: c.pendingRegulatorFilings ?? 0,
  };
}

function buildOfftake(l: Partial<OfftakeSnapshot>): OfftakeSnapshot {
  return {
    offtakeEndWithin60d: l.offtakeEndWithin60d ?? 0,
    pendingRenewals: l.pendingRenewals ?? 0,
    churnProbability: l.churnProbability ?? 0,
    avgPriceVsMarketPct: l.avgPriceVsMarketPct ?? 0,
    availableCapacityWaterfall30d: l.availableCapacityWaterfall30d ?? 0,
  };
}

function buildInspection(i: Partial<InspectionSnapshot>): InspectionSnapshot {
  return {
    overdueInspections: i.overdueInspections ?? 0,
    lastInspectionScore: i.lastInspectionScore ?? null,
    failedItems: i.failedItems ?? 0,
  };
}

function buildFAR(f: Partial<FARSnapshot>): FARSnapshot {
  return {
    assetsUnderService: f.assetsUnderService ?? 0,
    assetsNearingEOL: f.assetsNearingEOL ?? 0,
    totalReplacementCostCents: f.totalReplacementCostCents ?? 0,
    depreciatedValueCents: f.depreciatedValueCents ?? 0,
  };
}

function buildCounterpartyRisk(t: Partial<CounterpartyRiskSnapshot>): CounterpartyRiskSnapshot {
  return {
    riskGrade: t.riskGrade ?? 'C',
    riskScore: t.riskScore ?? 50,
    disputeCount: t.disputeCount ?? 0,
    complaintsLast90d: t.complaintsLast90d ?? 0,
    paymentReliabilityPct: t.paymentReliabilityPct ?? 100,
  };
}

function buildProduction(o: Partial<ProductionSnapshot>): ProductionSnapshot {
  return {
    productionPct: o.productionPct ?? 100,
    availableCapacityCount: o.availableCapacityCount ?? 0,
    avgAvailableCapacityDays: o.avgAvailableCapacityDays ?? 0,
    timeToCommissionDays: o.timeToCommissionDays ?? 0,
  };
}
