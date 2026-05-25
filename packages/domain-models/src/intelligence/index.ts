/**
 * Intelligence domain models
 * AI personalization, risk scoring, and next best actions
 */

// Re-export additional intelligence models
export * from './tenant-preference-profile';
export * from './friction-fingerprint';
// Namespaced to avoid collision with identity/tenant-identity's
// isMembershipActive (OrgMembership vs CustomerSegmentMembership).
export * as TenantSegment from './tenant-segment';
export * from './intervention-log';

import type { Brand, TenantId, UserId, ISOTimestamp } from '../common/types';

// ============================================================================
// Type Aliases
// ============================================================================

export type CustomerPreferencesId = Brand<string, 'CustomerPreferencesId'>;
export type RiskScoreId = Brand<string, 'RiskScoreId'>;
export type NextBestActionId = Brand<string, 'NextBestActionId'>;

export function asCustomerPreferencesId(id: string): CustomerPreferencesId {
  return id as CustomerPreferencesId;
}

export function asRiskScoreId(id: string): RiskScoreId {
  return id as RiskScoreId;
}

export function asNextBestActionId(id: string): NextBestActionId {
  return id as NextBestActionId;
}

// ============================================================================
// Enums
// ============================================================================

export type PreferredChannel = 'email' | 'sms' | 'whatsapp' | 'push' | 'in_app' | 'phone';

export type CommsStyle = 'formal' | 'casual' | 'brief' | 'detailed';

export type RiskLevel = 'very_low' | 'low' | 'medium' | 'high' | 'very_high' | 'critical';

export type RiskType = 'payment' | 'churn' | 'dispute' | 'maintenance' | 'compliance';

export type ActionType =
  | 'payment_reminder'
  | 'offer_payment_plan'
  | 'send_promotion'
  | 'schedule_check_in'
  | 'escalate_to_manager'
  | 'send_survey'
  | 'renewal_offer'
  | 'retention_outreach'
  | 'maintenance_follow_up'
  | 'welcome_message'
  | 'feedback_request';

export type ActionStatus = 'pending' | 'scheduled' | 'executed' | 'completed' | 'skipped' | 'failed';

export type ActionOutcome = 'success' | 'partial_success' | 'no_response' | 'negative_response' | 'failed';

// ============================================================================
// Customer Preferences Entity
// ============================================================================

/** Quiet hours configuration */
export interface QuietHours {
  readonly start: string; // e.g., "22:00"
  readonly end: string; // e.g., "07:00"
  readonly timezone: string;
  readonly daysOfWeek?: readonly number[]; // 0-6, Sunday = 0
}

/**
 * Customer Preferences entity
 * Communication and notification preferences for a customer
 */
export interface CustomerPreferences {
  readonly id: CustomerPreferencesId;
  readonly tenantId: TenantId;
  readonly customerId: string;
  
  // Language
  readonly language: string;
  
  // Communication preferences
  readonly preferredChannel: PreferredChannel;
  readonly secondaryChannel: PreferredChannel | null;
  readonly quietHours: QuietHours | null;
  readonly commsStyle: CommsStyle;
  
  // Opt-ins
  readonly marketingOptIn: boolean;
  readonly promotionalOptIn: boolean;
  readonly surveyOptIn: boolean;
  
  // Interests (for personalization)
  readonly interests: readonly string[];
  
  // Contact preferences
  readonly preferredContactTime: string | null; // e.g., "morning", "afternoon", "evening"
  readonly doNotContact: boolean;
  
  // Timestamps
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId | null;
  readonly updatedBy: UserId | null;
}

// ============================================================================
// Risk Score Entity
// ============================================================================

/** Factor contributing to risk score */
export interface RiskFactor {
  readonly name: string;
  readonly weight: number;
  readonly value: number;
  readonly impact: 'positive' | 'negative' | 'neutral';
  readonly description: string;
}

/**
 * Risk Score entity
 * AI-calculated risk assessment for a customer
 */
export interface RiskScore {
  readonly id: RiskScoreId;
  readonly tenantId: TenantId;
  readonly customerId: string;
  
  // Individual risk scores (0-100)
  readonly paymentRiskScore: number | null;
  readonly churnRiskScore: number | null;
  readonly disputeRiskScore: number | null;
  
  // Overall risk
  readonly overallRiskScore: number | null;
  readonly riskLevel: RiskLevel;
  
  // Calculation details
  readonly lastCalculated: ISOTimestamp;
  readonly calculationVersion: string;
  readonly factors: readonly RiskFactor[];
  
  // History
  readonly scoreHistory: readonly { score: number; date: ISOTimestamp }[];
  
  // Timestamps
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

// ============================================================================
// Next Best Action Entity
// ============================================================================

/**
 * Next Best Action entity
 * AI-recommended action for customer engagement
 */
export interface NextBestAction {
  readonly id: NextBestActionId;
  readonly tenantId: TenantId;
  readonly customerId: string;
  
  // Action details
  readonly actionType: ActionType;
  readonly priority: number; // 1-100, higher = more important
  readonly reasoning: string;
  readonly confidenceScore: number | null; // 0-100
  
  // Timing
  readonly recommendedAt: ISOTimestamp;
  readonly expiresAt: ISOTimestamp | null;
  
  // Status
  readonly status: ActionStatus;
  
  // Execution
  readonly executedAt: ISOTimestamp | null;
  readonly executedBy: UserId | null;
  readonly executionChannel: PreferredChannel | null;
  
  // Outcome
  readonly outcome: ActionOutcome | null;
  readonly outcomeDetails: string | null;
  readonly outcomeRecordedAt: ISOTimestamp | null;
  
  // Context
  readonly context: Record<string, unknown>;
  readonly parameters: Record<string, unknown>;
  
  // Timestamps
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId | null;
  readonly updatedBy: UserId | null;
}

// ============================================================================
// Factory Functions
// ============================================================================

/** Create default customer preferences */
export function createCustomerPreferences(
  id: CustomerPreferencesId,
  data: {
    tenantId: TenantId;
    customerId: string;
    language?: string;
    preferredChannel?: PreferredChannel;
  },
  createdBy: UserId
): CustomerPreferences {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    customerId: data.customerId,
    language: data.language ?? 'en',
    preferredChannel: data.preferredChannel ?? 'email',
    secondaryChannel: null,
    quietHours: null,
    commsStyle: 'formal',
    marketingOptIn: false,
    promotionalOptIn: false,
    surveyOptIn: true,
    interests: [],
    preferredContactTime: null,
    doNotContact: false,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  };
}

/** Calculate overall risk level from score */
export function getRiskLevel(score: number | null): RiskLevel {
  if (score === null) return 'medium';
  if (score >= 90) return 'critical';
  if (score >= 75) return 'very_high';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  if (score >= 20) return 'low';
  return 'very_low';
}

/** Create a new next best action */
export function createNextBestAction(
  id: NextBestActionId,
  data: {
    tenantId: TenantId;
    customerId: string;
    actionType: ActionType;
    priority: number;
    reasoning: string;
    confidenceScore?: number;
    expiresAt?: ISOTimestamp;
    context?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
  },
  createdBy: UserId
): NextBestAction {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    customerId: data.customerId,
    actionType: data.actionType,
    priority: data.priority,
    reasoning: data.reasoning,
    confidenceScore: data.confidenceScore ?? null,
    recommendedAt: now,
    expiresAt: data.expiresAt ?? null,
    status: 'pending',
    executedAt: null,
    executedBy: null,
    executionChannel: null,
    outcome: null,
    outcomeDetails: null,
    outcomeRecordedAt: null,
    context: data.context ?? {},
    parameters: data.parameters ?? {},
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  };
}

/** Execute a next best action */
export function executeAction(
  action: NextBestAction,
  channel: PreferredChannel,
  executedBy: UserId
): NextBestAction {
  const now = new Date().toISOString();
  return {
    ...action,
    status: 'executed',
    executedAt: now,
    executedBy,
    executionChannel: channel,
    updatedAt: now,
    updatedBy: executedBy,
  };
}

/** Record action outcome */
export function recordOutcome(
  action: NextBestAction,
  outcome: ActionOutcome,
  details: string | null,
  updatedBy: UserId
): NextBestAction {
  const now = new Date().toISOString();
  return {
    ...action,
    status: outcome === 'success' || outcome === 'partial_success' ? 'completed' : 'failed',
    outcome,
    outcomeDetails: details,
    outcomeRecordedAt: now,
    updatedAt: now,
    updatedBy,
  };
}

/** Check if action is expired */
export function isActionExpired(action: NextBestAction): boolean {
  if (!action.expiresAt) return false;
  return new Date(action.expiresAt) < new Date();
}
