/**
 * Friction Fingerprint domain model
 * Customer-specific sensitivity profile for AI-native personalization
 */

import { z } from 'zod';
import type { Brand, TenantId, UserId, ISOTimestamp } from '../common/types';
import type { CustomerId } from '../payments/payment-intent';

// ============================================================================
// Type Aliases
// ============================================================================

export type FrictionFingerprintId = Brand<string, 'FrictionFingerprintId'>;

export function asFrictionFingerprintId(id: string): FrictionFingerprintId {
  return id as FrictionFingerprintId;
}

// ============================================================================
// Nested Types
// ============================================================================

/** Common issue pattern */
export interface IssuePattern {
  readonly category: string;
  readonly subcategory: string | null;
  readonly frequency: number;
  readonly avgResolutionTime: number | null;
  readonly satisfactionScore: number | null;
  readonly lastOccurrence: ISOTimestamp;
}

export const IssuePatternSchema = z.object({
  category: z.string(),
  subcategory: z.string().nullable(),
  frequency: z.number(),
  avgResolutionTime: z.number().nullable(),
  satisfactionScore: z.number().nullable(),
  lastOccurrence: z.string().datetime(),
});

/** Trigger pattern that causes friction */
export interface TriggerPattern {
  readonly trigger: string;
  readonly context: string | null;
  readonly severity: 'low' | 'medium' | 'high';
  readonly occurrences: number;
  readonly recommendedAction: string | null;
}

export const TriggerPatternSchema = z.object({
  trigger: z.string(),
  context: z.string().nullable(),
  severity: z.enum(['low', 'medium', 'high']),
  occurrences: z.number(),
  recommendedAction: z.string().nullable(),
});

/** Past friction event */
export interface FrictionEvent {
  readonly id: string;
  readonly type: string;
  readonly description: string;
  readonly occurredAt: ISOTimestamp;
  readonly resolvedAt: ISOTimestamp | null;
  readonly sentiment: number | null;
  readonly outcome: 'positive' | 'neutral' | 'negative' | null;
}

export const FrictionEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string(),
  occurredAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  sentiment: z.number().nullable(),
  outcome: z.enum(['positive', 'neutral', 'negative']).nullable(),
});

// ============================================================================
// Zod Schema
// ============================================================================

export const FrictionFingerprintSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),

  // Sensitivity scores (0-100)
  noiseSensitivity: z.number().min(0).max(100).default(50),
  maintenanceSensitivity: z.number().min(0).max(100).default(50),
  communicationSensitivity: z.number().min(0).max(100).default(50),
  priceSensitivity: z.number().min(0).max(100).default(50),
  cleanlinessExpectation: z.number().min(0).max(100).default(50),
  privacyPreference: z.number().min(0).max(100).default(50),

  // Response patterns
  avgResponseTime: z.number().nullable(),
  preferredResponseWindow: z.string().nullable(),

  // Sentiment
  baselineSentiment: z.number().nullable(),
  currentSentiment: z.number().nullable(),
  sentimentTrend: z.enum(['improving', 'stable', 'declining']).nullable(),

  // Patterns
  commonIssues: z.array(IssuePatternSchema).default([]),
  triggerPatterns: z.array(TriggerPatternSchema).default([]),

  // Communication style
  communicationStyle: z.enum(['formal', 'casual', 'brief', 'detailed']).nullable(),
  formalityLevel: z.enum(['high', 'medium', 'low']).nullable(),
  detailPreference: z.enum(['minimal', 'moderate', 'comprehensive']).nullable(),

  // History
  pastFrictions: z.array(FrictionEventSchema).default([]),
  resolvedFrictions: z.array(FrictionEventSchema).default([]),

  // Confidence
  confidenceScore: z.number().nullable(),
  dataPoints: z.number().default(0),

  // Last update
  lastSignalAt: z.string().datetime().nullable(),
  lastSignalSource: z.string().nullable(),
});

export type FrictionFingerprintData = z.infer<typeof FrictionFingerprintSchema>;

// ============================================================================
// Interface
// ============================================================================

export interface FrictionFingerprint {
  readonly id: FrictionFingerprintId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;

  // Sensitivity scores (0-100)
  readonly noiseSensitivity: number;
  readonly maintenanceSensitivity: number;
  readonly communicationSensitivity: number;
  readonly priceSensitivity: number;
  readonly cleanlinessExpectation: number;
  readonly privacyPreference: number;

  // Response patterns
  readonly avgResponseTime: number | null;
  readonly preferredResponseWindow: string | null;

  // Sentiment
  readonly baselineSentiment: number | null;
  readonly currentSentiment: number | null;
  readonly sentimentTrend: 'improving' | 'stable' | 'declining' | null;

  // Patterns
  readonly commonIssues: readonly IssuePattern[];
  readonly triggerPatterns: readonly TriggerPattern[];

  // Communication style
  readonly communicationStyle: 'formal' | 'casual' | 'brief' | 'detailed' | null;
  readonly formalityLevel: 'high' | 'medium' | 'low' | null;
  readonly detailPreference: 'minimal' | 'moderate' | 'comprehensive' | null;

  // History
  readonly pastFrictions: readonly FrictionEvent[];
  readonly resolvedFrictions: readonly FrictionEvent[];

  // Confidence
  readonly confidenceScore: number | null;
  readonly dataPoints: number;

  // Last update
  readonly lastSignalAt: ISOTimestamp | null;
  readonly lastSignalSource: string | null;

  // Timestamps
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createFrictionFingerprint(
  id: FrictionFingerprintId,
  data: {
    tenantId: TenantId;
    customerId: CustomerId;
  }
): FrictionFingerprint {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    customerId: data.customerId,

    noiseSensitivity: 50,
    maintenanceSensitivity: 50,
    communicationSensitivity: 50,
    priceSensitivity: 50,
    cleanlinessExpectation: 50,
    privacyPreference: 50,

    avgResponseTime: null,
    preferredResponseWindow: null,

    baselineSentiment: null,
    currentSentiment: null,
    sentimentTrend: null,

    commonIssues: [],
    triggerPatterns: [],

    communicationStyle: null,
    formalityLevel: null,
    detailPreference: null,

    pastFrictions: [],
    resolvedFrictions: [],

    confidenceScore: null,
    dataPoints: 0,

    lastSignalAt: null,
    lastSignalSource: null,

    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function updateSensitivityScores(
  fingerprint: FrictionFingerprint,
  scores: {
    noiseSensitivity?: number;
    maintenanceSensitivity?: number;
    communicationSensitivity?: number;
    priceSensitivity?: number;
    cleanlinessExpectation?: number;
    privacyPreference?: number;
  }
): FrictionFingerprint {
  const now = new Date().toISOString();
  return {
    ...fingerprint,
    noiseSensitivity: scores.noiseSensitivity ?? fingerprint.noiseSensitivity,
    maintenanceSensitivity: scores.maintenanceSensitivity ?? fingerprint.maintenanceSensitivity,
    communicationSensitivity: scores.communicationSensitivity ?? fingerprint.communicationSensitivity,
    priceSensitivity: scores.priceSensitivity ?? fingerprint.priceSensitivity,
    cleanlinessExpectation: scores.cleanlinessExpectation ?? fingerprint.cleanlinessExpectation,
    privacyPreference: scores.privacyPreference ?? fingerprint.privacyPreference,
    dataPoints: fingerprint.dataPoints + 1,
    updatedAt: now,
  };
}

export function recordSentiment(
  fingerprint: FrictionFingerprint,
  sentiment: number,
  source: string
): FrictionFingerprint {
  const now = new Date().toISOString();

  // Calculate trend
  let trend: 'improving' | 'stable' | 'declining' | null = null;
  if (fingerprint.currentSentiment !== null) {
    const diff = sentiment - fingerprint.currentSentiment;
    if (diff > 0.1) trend = 'improving';
    else if (diff < -0.1) trend = 'declining';
    else trend = 'stable';
  }

  return {
    ...fingerprint,
    baselineSentiment: fingerprint.baselineSentiment ?? sentiment,
    currentSentiment: sentiment,
    sentimentTrend: trend,
    lastSignalAt: now,
    lastSignalSource: source,
    dataPoints: fingerprint.dataPoints + 1,
    updatedAt: now,
  };
}

export function addFrictionEvent(
  fingerprint: FrictionFingerprint,
  event: Omit<FrictionEvent, 'id' | 'occurredAt'>
): FrictionFingerprint {
  const now = new Date().toISOString();
  const newEvent: FrictionEvent = {
    id: `friction_${Date.now()}`,
    ...event,
    occurredAt: now,
  };

  return {
    ...fingerprint,
    pastFrictions: [...fingerprint.pastFrictions, newEvent],
    dataPoints: fingerprint.dataPoints + 1,
    lastSignalAt: now,
    lastSignalSource: 'friction_event',
    updatedAt: now,
  };
}

export function resolveFriction(
  fingerprint: FrictionFingerprint,
  frictionId: string,
  outcome: 'positive' | 'neutral' | 'negative'
): FrictionFingerprint {
  const now = new Date().toISOString();
  const friction = fingerprint.pastFrictions.find((f) => f.id === frictionId);

  if (!friction) return fingerprint;

  const resolved: FrictionEvent = {
    ...friction,
    resolvedAt: now,
    outcome,
  };

  return {
    ...fingerprint,
    pastFrictions: fingerprint.pastFrictions.filter((f) => f.id !== frictionId),
    resolvedFrictions: [...fingerprint.resolvedFrictions, resolved],
    updatedAt: now,
  };
}

export function addIssuePattern(
  fingerprint: FrictionFingerprint,
  issue: Omit<IssuePattern, 'frequency' | 'lastOccurrence'>
): FrictionFingerprint {
  const now = new Date().toISOString();

  // Check if pattern exists
  const existingIndex = fingerprint.commonIssues.findIndex(
    (i) => i.category === issue.category && i.subcategory === issue.subcategory
  );

  let updatedIssues: IssuePattern[];
  if (existingIndex >= 0) {
    updatedIssues = fingerprint.commonIssues.map((i, idx) =>
      idx === existingIndex
        ? { ...i, frequency: i.frequency + 1, lastOccurrence: now }
        : i
    );
  } else {
    updatedIssues = [
      ...fingerprint.commonIssues,
      { ...issue, frequency: 1, lastOccurrence: now },
    ];
  }

  return {
    ...fingerprint,
    commonIssues: updatedIssues,
    dataPoints: fingerprint.dataPoints + 1,
    updatedAt: now,
  };
}

export function calculateOverallSensitivity(fingerprint: FrictionFingerprint): number {
  const scores = [
    fingerprint.noiseSensitivity,
    fingerprint.maintenanceSensitivity,
    fingerprint.communicationSensitivity,
    fingerprint.priceSensitivity,
    fingerprint.cleanlinessExpectation,
    fingerprint.privacyPreference,
  ];
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export function isSensitiveToNoise(fingerprint: FrictionFingerprint): boolean {
  return fingerprint.noiseSensitivity >= 70;
}

export function isSentimentDeclining(fingerprint: FrictionFingerprint): boolean {
  return fingerprint.sentimentTrend === 'declining';
}

export function hasUnresolvedFrictions(fingerprint: FrictionFingerprint): boolean {
  return fingerprint.pastFrictions.length > 0;
}

export function getConfidenceLevel(
  fingerprint: FrictionFingerprint
): 'low' | 'medium' | 'high' {
  if (fingerprint.dataPoints < 5) return 'low';
  if (fingerprint.dataPoints < 20) return 'medium';
  return 'high';
}
