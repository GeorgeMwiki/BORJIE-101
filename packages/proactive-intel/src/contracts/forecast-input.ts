/**
 * The slice of forecaster output that detectors consume.
 *
 * Mirrors the public `ForecastBand` from `@borjie/forecasting-engine`
 * but is copied here so this package compiles standalone. The
 * forecasting-engine adapter layer (one short bridge in the
 * orchestrator app) maps from the live forecaster output to these
 * shapes — keeps J5 dependency-free.
 */

export interface ForecastBand {
  readonly t: number; // ms since epoch
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
}

export interface CashflowForecastSlice {
  readonly tenantId: string;
  readonly cashBalanceNow: number;
  readonly horizonDays: number;
  readonly bands: ReadonlyArray<ForecastBand>;
  /** Tenant's owner-set "do not dip below" line in same currency units. */
  readonly safetyFloor: number;
}

export interface ArrearsTimePoint {
  readonly weekStartMs: number;
  readonly arrearsCount: number;
}

export interface ArrearsSeries {
  readonly tenantId: string;
  readonly weeks: ReadonlyArray<ArrearsTimePoint>;
}

export interface CustomerOwnerSignal {
  readonly customerOwnerId: string;
  /** Logins per 30d (rolling). */
  readonly engagement30d: number;
  /** 0..1 trend vs prior 30d window (negative = declining). */
  readonly engagementDelta: number;
  /** Complaints / tickets opened past 30d. */
  readonly complaintCount30d: number;
  /** Latest payment day-late count (NaN if no payments). */
  readonly latestPaymentLatenessDays: number;
}

export interface CostObservation {
  readonly tenantId: string;
  readonly aiCostUsdCents7d: number;
  /** Mean of prior 4 weeks. */
  readonly aiCostUsdCentsBaseline: number;
}

export interface SloObservation {
  readonly forecaster: string;
  readonly mae7d: number;
  readonly mae30dBaseline: number;
}

export type ComplianceDeadlineKind =
  | 'kra-filing'
  | 'firs-filing'
  | 'lease-renewal'
  | 'business-permit'
  | 'insurance-renewal';

export interface ComplianceDeadline {
  readonly tenantId: string;
  readonly kind: ComplianceDeadlineKind;
  readonly dueAtMs: number;
  readonly subjectId: string; // e.g. leaseId, filingId
  readonly subjectLabel: string;
}

export interface VendorOnTimeHistory {
  readonly tenantId: string;
  readonly vendorId: string;
  readonly vendorName: string;
  /** 0..1, rolling 90d on-time rate. */
  readonly onTimeRate90d: number;
  /** 0..1, prior 90d (the window before that). */
  readonly onTimeRatePrior: number;
}
