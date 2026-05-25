/**
 * Vendor Scorecard domain model
 * Periodic performance tracking for vendors (separate from JSONB)
 */

import type { Brand, TenantId, UserId, ISOTimestamp } from '../common/types';
import type { VendorId } from './vendor';

export type VendorScorecardId = Brand<string, 'VendorScorecardId'>;

export function asVendorScorecardId(id: string): VendorScorecardId {
  return id as VendorScorecardId;
}

/**
 * Vendor Scorecard entity
 * Monthly performance metrics for vendor evaluation
 */
export interface VendorScorecard {
  readonly id: VendorScorecardId;
  readonly tenantId: TenantId;
  readonly vendorId: VendorId;
  
  // Period (month/year format)
  readonly periodMonth: number; // 1-12
  readonly periodYear: number;
  
  // Performance Metrics (scores out of 100 or specific units)
  readonly responseTime: number | null; // Average response time in minutes
  readonly qualityScore: number | null; // 0-100 quality rating
  readonly reopenRate: number | null; // Percentage of work orders reopened (0-100)
  readonly slaCompliance: number | null; // SLA compliance percentage (0-100)
  readonly tenantSatisfaction: number | null; // Satisfaction score (0-100)
  readonly costEfficiency: number | null; // Cost efficiency score (0-100)
  
  // Aggregated data
  readonly totalWorkOrders: number;
  readonly completedWorkOrders: number;
  readonly onTimeCompletions: number;
  readonly averageRating: number | null; // Average customer rating (0-100)
  
  // Overall score
  readonly overallScore: number | null; // Weighted composite score (0-100)
  
  // Notes
  readonly notes: string | null;
  
  // Timestamps
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId | null;
  readonly updatedBy: UserId | null;
}

/** Create a new vendor scorecard */
export function createVendorScorecard(
  id: VendorScorecardId,
  data: {
    tenantId: TenantId;
    vendorId: VendorId;
    periodMonth: number;
    periodYear: number;
  },
  createdBy: UserId
): VendorScorecard {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    vendorId: data.vendorId,
    periodMonth: data.periodMonth,
    periodYear: data.periodYear,
    responseTime: null,
    qualityScore: null,
    reopenRate: null,
    slaCompliance: null,
    tenantSatisfaction: null,
    costEfficiency: null,
    totalWorkOrders: 0,
    completedWorkOrders: 0,
    onTimeCompletions: 0,
    averageRating: null,
    overallScore: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  };
}

/** Get performance tier based on overall score */
export function getPerformanceTier(overallScore: number | null): 'platinum' | 'gold' | 'silver' | 'bronze' | 'needs_improvement' | 'unrated' {
  if (overallScore === null) return 'unrated';
  if (overallScore >= 90) return 'platinum';
  if (overallScore >= 80) return 'gold';
  if (overallScore >= 70) return 'silver';
  if (overallScore >= 60) return 'bronze';
  return 'needs_improvement';
}

/** Format period as string (e.g., "2024-01") */
export function formatPeriod(periodYear: number, periodMonth: number): string {
  return `${periodYear}-${String(periodMonth).padStart(2, '0')}`;
}

/** Get completion rate */
export function getCompletionRate(scorecard: VendorScorecard): number {
  if (scorecard.totalWorkOrders === 0) return 0;
  return Math.round((scorecard.completedWorkOrders / scorecard.totalWorkOrders) * 100);
}

/** Get on-time rate */
export function getOnTimeRate(scorecard: VendorScorecard): number {
  if (scorecard.completedWorkOrders === 0) return 0;
  return Math.round((scorecard.onTimeCompletions / scorecard.completedWorkOrders) * 100);
}
