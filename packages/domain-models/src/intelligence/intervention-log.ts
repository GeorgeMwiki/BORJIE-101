/**
 * Intervention Log domain model
 * Log of executed AI interventions and their outcomes
 */

import { z } from 'zod';
import type { Brand, TenantId, UserId, ISOTimestamp } from '../common/types';
import type { CustomerId } from '../payments/payment-intent';
import { ChannelPreference, ChannelPreferenceSchema } from '../common/enums';
import type { NextBestActionId } from './index';

// ============================================================================
// Type Aliases
// ============================================================================

export type InterventionLogId = Brand<string, 'InterventionLogId'>;

export function asInterventionLogId(id: string): InterventionLogId {
  return id as InterventionLogId;
}

// ============================================================================
// Nested Types
// ============================================================================

/** Offer details included in intervention */
export interface OfferDetails {
  readonly offerType: string;
  readonly description: string;
  readonly value: number | null;
  readonly currency: string | null;
  readonly validUntil: ISOTimestamp | null;
  readonly terms: string | null;
}

export const OfferDetailsSchema = z.object({
  offerType: z.string(),
  description: z.string(),
  value: z.number().nullable(),
  currency: z.string().nullable(),
  validUntil: z.string().datetime().nullable(),
  terms: z.string().nullable(),
});

/** State snapshot for before/after comparison */
export interface StateSnapshot {
  readonly balanceOwed: number | null;
  readonly daysOverdue: number | null;
  readonly paymentScore: number | null;
  readonly sentimentScore: number | null;
  readonly churnRisk: number | null;
  readonly engagementLevel: string | null;
  readonly openIssues: number | null;
  readonly additionalMetrics: Record<string, unknown>;
}

export const StateSnapshotSchema = z.object({
  balanceOwed: z.number().nullable(),
  daysOverdue: z.number().nullable(),
  paymentScore: z.number().nullable(),
  sentimentScore: z.number().nullable(),
  churnRisk: z.number().nullable(),
  engagementLevel: z.string().nullable(),
  openIssues: z.number().nullable(),
  additionalMetrics: z.record(z.string(), z.unknown()),
});

/** Success metrics for intervention */
export interface SuccessMetrics {
  readonly targetMetric: string;
  readonly baselineValue: number;
  readonly targetValue: number;
  readonly achievedValue: number | null;
  readonly percentageChange: number | null;
  readonly metTarget: boolean | null;
}

export const SuccessMetricsSchema = z.object({
  targetMetric: z.string(),
  baselineValue: z.number(),
  targetValue: z.number(),
  achievedValue: z.number().nullable(),
  percentageChange: z.number().nullable(),
  metTarget: z.boolean().nullable(),
});

// ============================================================================
// Zod Schema
// ============================================================================

export const InterventionLogSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),
  nextBestActionId: z.string().nullable(),

  // Intervention details
  interventionType: z.string(),
  channel: ChannelPreferenceSchema.nullable(),

  // Content
  messageContent: z.string().nullable(),
  offerDetails: OfferDetailsSchema.nullable(),

  // Execution
  executedAt: z.string().datetime(),
  executedBy: z.string().nullable(),
  executionMethod: z.string().nullable(),

  // Response
  responseReceivedAt: z.string().datetime().nullable(),
  responseType: z.string().nullable(),
  responseContent: z.string().nullable(),

  // Outcome measurement
  preInterventionState: StateSnapshotSchema,
  postInterventionState: StateSnapshotSchema.nullable(),
  measuredAt: z.string().datetime().nullable(),

  // Success metrics
  wasSuccessful: z.boolean().nullable(),
  successMetrics: z.array(SuccessMetricsSchema).default([]),

  // Cost
  cost: z.number().nullable(),
  costCurrency: z.string().default('USD'),
});

export type InterventionLogData = z.infer<typeof InterventionLogSchema>;

// ============================================================================
// Interface
// ============================================================================

export interface InterventionLog {
  readonly id: InterventionLogId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly nextBestActionId: NextBestActionId | null;

  // Intervention details
  readonly interventionType: string;
  readonly channel: ChannelPreference | null;

  // Content
  readonly messageContent: string | null;
  readonly offerDetails: OfferDetails | null;

  // Execution
  readonly executedAt: ISOTimestamp;
  readonly executedBy: UserId | null;
  readonly executionMethod: string | null;

  // Response
  readonly responseReceivedAt: ISOTimestamp | null;
  readonly responseType: string | null;
  readonly responseContent: string | null;

  // Outcome measurement
  readonly preInterventionState: StateSnapshot;
  readonly postInterventionState: StateSnapshot | null;
  readonly measuredAt: ISOTimestamp | null;

  // Success metrics
  readonly wasSuccessful: boolean | null;
  readonly successMetrics: readonly SuccessMetrics[];

  // Cost
  readonly cost: number | null;
  readonly costCurrency: string;

  // Timestamps
  readonly createdAt: ISOTimestamp;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createInterventionLog(
  id: InterventionLogId,
  data: {
    tenantId: TenantId;
    customerId: CustomerId;
    nextBestActionId?: NextBestActionId;
    interventionType: string;
    channel?: ChannelPreference;
    messageContent?: string;
    offerDetails?: OfferDetails;
    executedBy?: UserId;
    executionMethod?: string;
    preInterventionState: StateSnapshot;
    cost?: number;
    costCurrency?: string;
  }
): InterventionLog {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    customerId: data.customerId,
    nextBestActionId: data.nextBestActionId ?? null,

    interventionType: data.interventionType,
    channel: data.channel ?? null,

    messageContent: data.messageContent ?? null,
    offerDetails: data.offerDetails ?? null,

    executedAt: now,
    executedBy: data.executedBy ?? null,
    executionMethod: data.executionMethod ?? null,

    responseReceivedAt: null,
    responseType: null,
    responseContent: null,

    preInterventionState: data.preInterventionState,
    postInterventionState: null,
    measuredAt: null,

    wasSuccessful: null,
    successMetrics: [],

    cost: data.cost ?? null,
    costCurrency: data.costCurrency ?? 'USD',

    createdAt: now,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function recordResponse(
  log: InterventionLog,
  responseType: string,
  responseContent: string | null
): InterventionLog {
  const now = new Date().toISOString();
  return {
    ...log,
    responseReceivedAt: now,
    responseType,
    responseContent,
  };
}

export function measureOutcome(
  log: InterventionLog,
  postState: StateSnapshot,
  metrics: SuccessMetrics[]
): InterventionLog {
  const now = new Date().toISOString();

  // Determine overall success
  const wasSuccessful = metrics.length > 0 && metrics.some((m) => m.metTarget === true);

  return {
    ...log,
    postInterventionState: postState,
    measuredAt: now,
    successMetrics: metrics,
    wasSuccessful,
  };
}

export function markSuccessful(log: InterventionLog, wasSuccessful: boolean): InterventionLog {
  return {
    ...log,
    wasSuccessful,
  };
}

export function hasResponse(log: InterventionLog): boolean {
  return log.responseReceivedAt !== null;
}

export function isOutcomeMeasured(log: InterventionLog): boolean {
  return log.measuredAt !== null;
}

export function getResponseTime(log: InterventionLog): number | null {
  if (!log.responseReceivedAt) return null;
  const executed = new Date(log.executedAt);
  const responded = new Date(log.responseReceivedAt);
  return responded.getTime() - executed.getTime();
}

export function calculateROI(log: InterventionLog): number | null {
  if (!log.cost || !log.wasSuccessful || !log.postInterventionState) return null;

  const preBalance = log.preInterventionState.balanceOwed;
  const postBalance = log.postInterventionState.balanceOwed;

  if (preBalance === null || postBalance === null) return null;

  const recovered = preBalance - postBalance;
  if (recovered <= 0) return 0;

  return ((recovered - log.cost) / log.cost) * 100;
}

export function createDefaultPreState(): StateSnapshot {
  return {
    balanceOwed: null,
    daysOverdue: null,
    paymentScore: null,
    sentimentScore: null,
    churnRisk: null,
    engagementLevel: null,
    openIssues: null,
    additionalMetrics: {},
  };
}
