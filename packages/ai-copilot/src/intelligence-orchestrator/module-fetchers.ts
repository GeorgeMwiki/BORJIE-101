/**
 * Module Data Fetchers — interface + in-memory mock.
 *
 * Typed fetchers for each BORJIE domain. Each fetcher is tenant-scoped
 * and returns a null-safe snapshot consumable by the orchestrator.
 *
 * Real implementations bridge to domain-services (arrears, maintenance,
 * compliance, leasing, inspection, FAR, tenant-risk, occupancy). A mock
 * implementation is provided for tests and local-dev bootstrapping.
 *
 * @module intelligence-orchestrator/module-fetchers
 */

import type {
  PaymentsSnapshot,
  MaintenanceSnapshot,
  ComplianceSnapshot,
  LeasingSnapshot,
  InspectionSnapshot,
  FARSnapshot,
  TenantRiskSnapshot,
  OccupancySnapshot,
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
  fetchLeasing(
    scopeKind: string,
    scopeId: string,
    tenantId: string,
  ): Promise<LeasingSnapshot | null>;
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
  fetchTenantRisk(
    scopeKind: string,
    scopeId: string,
    tenantId: string,
  ): Promise<TenantRiskSnapshot | null>;
  fetchOccupancy(
    scopeKind: string,
    scopeId: string,
    tenantId: string,
  ): Promise<OccupancySnapshot | null>;
}

// ============================================================================
// Mock fetchers for tests / local-dev
// ============================================================================

export interface MockSnapshots {
  readonly payments?: Partial<PaymentsSnapshot> | null;
  readonly maintenance?: Partial<MaintenanceSnapshot> | null;
  readonly compliance?: Partial<ComplianceSnapshot> | null;
  readonly leasing?: Partial<LeasingSnapshot> | null;
  readonly inspection?: Partial<InspectionSnapshot> | null;
  readonly far?: Partial<FARSnapshot> | null;
  readonly tenantRisk?: Partial<TenantRiskSnapshot> | null;
  readonly occupancy?: Partial<OccupancySnapshot> | null;
}

export function createMockFetchers(snapshots: MockSnapshots): ModuleDataFetchers {
  const p = snapshots.payments;
  const m = snapshots.maintenance;
  const c = snapshots.compliance;
  const l = snapshots.leasing;
  const i = snapshots.inspection;
  const f = snapshots.far;
  const t = snapshots.tenantRisk;
  const o = snapshots.occupancy;

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
    async fetchLeasing() {
      return l === null ? null : l ? buildLeasing(l) : null;
    },
    async fetchInspection() {
      return i === null ? null : i ? buildInspection(i) : null;
    },
    async fetchFAR() {
      return f === null ? null : f ? buildFAR(f) : null;
    },
    async fetchTenantRisk() {
      return t === null ? null : t ? buildTenantRisk(t) : null;
    },
    async fetchOccupancy() {
      return o === null ? null : o ? buildOccupancy(o) : null;
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
    pendingNoticesToTenants: c.pendingNoticesToTenants ?? 0,
    pendingRegulatorFilings: c.pendingRegulatorFilings ?? 0,
  };
}

function buildLeasing(l: Partial<LeasingSnapshot>): LeasingSnapshot {
  return {
    leaseEndWithin60d: l.leaseEndWithin60d ?? 0,
    pendingRenewals: l.pendingRenewals ?? 0,
    churnProbability: l.churnProbability ?? 0,
    avgRentVsMarketPct: l.avgRentVsMarketPct ?? 0,
    vacancyWaterfall30d: l.vacancyWaterfall30d ?? 0,
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

function buildTenantRisk(t: Partial<TenantRiskSnapshot>): TenantRiskSnapshot {
  return {
    riskGrade: t.riskGrade ?? 'C',
    riskScore: t.riskScore ?? 50,
    disputeCount: t.disputeCount ?? 0,
    complaintsLast90d: t.complaintsLast90d ?? 0,
    paymentReliabilityPct: t.paymentReliabilityPct ?? 100,
  };
}

function buildOccupancy(o: Partial<OccupancySnapshot>): OccupancySnapshot {
  return {
    occupancyPct: o.occupancyPct ?? 100,
    vacancyCount: o.vacancyCount ?? 0,
    avgVacancyDays: o.avgVacancyDays ?? 0,
    timeOnMarketDays: o.timeOnMarketDays ?? 0,
  };
}
