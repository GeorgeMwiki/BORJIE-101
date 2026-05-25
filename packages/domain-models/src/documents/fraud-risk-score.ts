/**
 * Fraud Risk Score domain model
 * Document fraud risk assessment from AI/ML analysis
 */

import { z } from 'zod';
import type { Brand, TenantId, UserId, ISOTimestamp } from '../common/types';
import type { CustomerId } from '../payments/payment-intent';
import { FraudRiskLevel, FraudRiskLevelSchema } from '../common/enums';
import type { DocumentUploadId } from './document-upload';

// ============================================================================
// Type Aliases
// ============================================================================

export type FraudRiskScoreId = Brand<string, 'FraudRiskScoreId'>;

export function asFraudRiskScoreId(id: string): FraudRiskScoreId {
  return id as FraudRiskScoreId;
}

// ============================================================================
// Nested Types
// ============================================================================

/** Individual fraud indicator */
export interface FraudIndicator {
  readonly indicatorType: string;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly description: string;
  readonly confidence: number;
  readonly evidence: string | null;
  readonly recommendation: string | null;
}

export const FraudIndicatorSchema = z.object({
  indicatorType: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  description: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().nullable(),
  recommendation: z.string().nullable(),
});

// ============================================================================
// Zod Schema
// ============================================================================

export const FraudRiskScoreSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  documentUploadId: z.string().nullable(),
  customerId: z.string().nullable(),

  riskLevel: FraudRiskLevelSchema,
  score: z.number().min(0).max(1),

  indicators: z.array(FraudIndicatorSchema).default([]),
  primaryIndicator: z.string().nullable(),

  modelVersion: z.string(),
  modelConfidence: z.number().nullable(),

  decision: z.string().nullable(),
  decisionReason: z.string().nullable(),
  reviewRequired: z.boolean().default(false),

  reviewedAt: z.string().datetime().nullable(),
  reviewedBy: z.string().nullable(),
  reviewNotes: z.string().nullable(),

  calculatedAt: z.string().datetime(),
});

export type FraudRiskScoreData = z.infer<typeof FraudRiskScoreSchema>;

// ============================================================================
// Interface
// ============================================================================

export interface FraudRiskScore {
  readonly id: FraudRiskScoreId;
  readonly tenantId: TenantId;
  readonly documentUploadId: DocumentUploadId | null;
  readonly customerId: CustomerId | null;

  readonly riskLevel: FraudRiskLevel;
  readonly score: number;

  readonly indicators: readonly FraudIndicator[];
  readonly primaryIndicator: string | null;

  readonly modelVersion: string;
  readonly modelConfidence: number | null;

  readonly decision: string | null;
  readonly decisionReason: string | null;
  readonly reviewRequired: boolean;

  readonly reviewedAt: ISOTimestamp | null;
  readonly reviewedBy: UserId | null;
  readonly reviewNotes: string | null;

  readonly calculatedAt: ISOTimestamp;
  readonly createdAt: ISOTimestamp;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createFraudRiskScore(
  id: FraudRiskScoreId,
  data: {
    tenantId: TenantId;
    documentUploadId?: DocumentUploadId;
    customerId?: CustomerId;
    score: number;
    modelVersion: string;
    modelConfidence?: number;
    indicators?: FraudIndicator[];
    primaryIndicator?: string;
  }
): FraudRiskScore {
  const now = new Date().toISOString();
  const riskLevel = scoreToRiskLevel(data.score);

  return {
    id,
    tenantId: data.tenantId,
    documentUploadId: data.documentUploadId ?? null,
    customerId: data.customerId ?? null,

    riskLevel,
    score: data.score,

    indicators: data.indicators ?? [],
    primaryIndicator: data.primaryIndicator ?? null,

    modelVersion: data.modelVersion,
    modelConfidence: data.modelConfidence ?? null,

    decision: null,
    decisionReason: null,
    reviewRequired: riskLevel === 'high' || riskLevel === 'critical',

    reviewedAt: null,
    reviewedBy: null,
    reviewNotes: null,

    calculatedAt: now,
    createdAt: now,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function scoreToRiskLevel(score: number): FraudRiskLevel {
  if (score >= 0.8) return 'critical';
  if (score >= 0.6) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

export function recordReview(
  fraudScore: FraudRiskScore,
  decision: string,
  decisionReason: string,
  notes: string | null,
  reviewedBy: UserId
): FraudRiskScore {
  const now = new Date().toISOString();
  return {
    ...fraudScore,
    decision,
    decisionReason,
    reviewRequired: false,
    reviewedAt: now,
    reviewedBy,
    reviewNotes: notes,
  };
}

export function addIndicator(
  fraudScore: FraudRiskScore,
  indicator: FraudIndicator
): FraudRiskScore {
  // Recalculate if new indicator is more severe
  const indicators = [...fraudScore.indicators, indicator];
  const primaryIndicator = getHighestSeverityIndicator(indicators);

  return {
    ...fraudScore,
    indicators,
    primaryIndicator: primaryIndicator?.indicatorType ?? fraudScore.primaryIndicator,
    reviewRequired: indicator.severity === 'high' || indicator.severity === 'critical',
  };
}

export function isHighRisk(fraudScore: FraudRiskScore): boolean {
  return fraudScore.riskLevel === 'high' || fraudScore.riskLevel === 'critical';
}

export function requiresManualReview(fraudScore: FraudRiskScore): boolean {
  return fraudScore.reviewRequired && fraudScore.reviewedAt === null;
}

export function isReviewed(fraudScore: FraudRiskScore): boolean {
  return fraudScore.reviewedAt !== null;
}

export function isApproved(fraudScore: FraudRiskScore): boolean {
  return fraudScore.decision === 'approved' || fraudScore.decision === 'accept';
}

export function isRejected(fraudScore: FraudRiskScore): boolean {
  return fraudScore.decision === 'rejected' || fraudScore.decision === 'reject';
}

function getHighestSeverityIndicator(
  indicators: readonly FraudIndicator[]
): FraudIndicator | null {
  if (indicators.length === 0) return null;

  const severityOrder: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  const first = indicators[0]!; // length > 0 checked above
  return indicators.reduce<FraudIndicator>((highest, current) => {
    const currentSeverity = severityOrder[current.severity] ?? 0;
    const highestSeverity = severityOrder[highest.severity] ?? 0;
    return currentSeverity > highestSeverity ? current : highest;
  }, first);
}

/** Get risk level display color */
export function getRiskLevelColor(level: FraudRiskLevel): string {
  const colors: Record<FraudRiskLevel, string> = {
    low: '#22c55e', // green
    medium: '#f59e0b', // amber
    high: '#ef4444', // red
    critical: '#991b1b', // dark red
  };
  return colors[level];
}

/** Get risk level display name */
export function getRiskLevelDisplayName(level: FraudRiskLevel): string {
  const names: Record<FraudRiskLevel, string> = {
    low: 'Low Risk',
    medium: 'Medium Risk',
    high: 'High Risk',
    critical: 'Critical Risk',
  };
  return names[level];
}

/** Common fraud indicator types */
export const FraudIndicatorTypes = {
  DOCUMENT_TAMPERING: 'document_tampering',
  INCONSISTENT_DATA: 'inconsistent_data',
  SUSPICIOUS_METADATA: 'suspicious_metadata',
  DUPLICATE_SUBMISSION: 'duplicate_submission',
  IDENTITY_MISMATCH: 'identity_mismatch',
  EXPIRED_DOCUMENT: 'expired_document',
  INVALID_FORMAT: 'invalid_format',
  BLACKLISTED_SOURCE: 'blacklisted_source',
  UNUSUAL_PATTERN: 'unusual_pattern',
  VELOCITY_CHECK_FAILED: 'velocity_check_failed',
} as const;

export type FraudIndicatorType = (typeof FraudIndicatorTypes)[keyof typeof FraudIndicatorTypes];
