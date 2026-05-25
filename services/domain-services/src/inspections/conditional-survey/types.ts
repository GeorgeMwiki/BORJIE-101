/**
 * Conditional Survey Domain Types (NEW 2)
 */

import type {
  TenantId,
  UserId,
  PropertyId,
  UnitId,
  ISOTimestamp,
} from '@borjie/domain-models';
import type { InspectionId } from '../types.js';

// ============================================================================
// Branded IDs
// ============================================================================

export type ConditionalSurveyId = string & { __brand: 'ConditionalSurveyId' };
export function asConditionalSurveyId(id: string): ConditionalSurveyId {
  return id as ConditionalSurveyId;
}

export type ConditionalSurveyFindingId = string & {
  __brand: 'ConditionalSurveyFindingId';
};
export function asConditionalSurveyFindingId(
  id: string
): ConditionalSurveyFindingId {
  return id as ConditionalSurveyFindingId;
}

export type ConditionalSurveyActionPlanId = string & {
  __brand: 'ConditionalSurveyActionPlanId';
};
export function asConditionalSurveyActionPlanId(
  id: string
): ConditionalSurveyActionPlanId {
  return id as ConditionalSurveyActionPlanId;
}

// ============================================================================
// Status / Severity / Action Status
// ============================================================================

export const CONDITIONAL_SURVEY_STATUSES = [
  'draft',
  'scheduled',
  'in_progress',
  'compiled',
  'approved',
  'archived',
  'cancelled',
] as const;
export type ConditionalSurveyStatus =
  (typeof CONDITIONAL_SURVEY_STATUSES)[number];

export const CONDITIONAL_SURVEY_SEVERITIES = [
  'low',
  'medium',
  'high',
  'critical',
] as const;
export type ConditionalSurveySeverity =
  (typeof CONDITIONAL_SURVEY_SEVERITIES)[number];

export const CONDITIONAL_SURVEY_ACTION_STATUSES = [
  'proposed',
  'approved',
  'in_progress',
  'completed',
  'deferred',
  'rejected',
] as const;
export type ConditionalSurveyActionStatus =
  (typeof CONDITIONAL_SURVEY_ACTION_STATUSES)[number];

// ============================================================================
// Entities
// ============================================================================

export interface ConditionalSurveyFinding {
  readonly id: ConditionalSurveyFindingId;
  readonly surveyId: ConditionalSurveyId;
  readonly tenantId: TenantId;
  readonly area: string;
  readonly title: string;
  readonly description: string | null;
  readonly severity: ConditionalSurveySeverity;
  readonly photos: readonly string[];
  readonly attachments: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: ISOTimestamp;
  readonly createdBy: UserId;
}

export interface ConditionalSurveyActionPlan {
  readonly id: ConditionalSurveyActionPlanId;
  readonly surveyId: ConditionalSurveyId;
  readonly findingId: ConditionalSurveyFindingId | null;
  readonly tenantId: TenantId;
  readonly title: string;
  readonly description: string | null;
  readonly priority: 1 | 2 | 3 | 4 | 5;
  readonly status: ConditionalSurveyActionStatus;
  readonly estimatedCostCents: number | null;
  readonly currency: string;
  readonly targetDate: ISOTimestamp | null;
  readonly approvedBy: UserId | null;
  readonly approvedAt: ISOTimestamp | null;
  readonly createdAt: ISOTimestamp;
  readonly createdBy: UserId;
}

export interface ConditionalSurvey {
  readonly id: ConditionalSurveyId;
  readonly tenantId: TenantId;
  readonly propertyId: PropertyId;
  readonly unitId: UnitId | null;
  readonly sourceInspectionId: InspectionId | null;
  readonly surveyorId: UserId | null;
  readonly status: ConditionalSurveyStatus;
  readonly scheduledAt: ISOTimestamp | null;
  readonly startedAt: ISOTimestamp | null;
  readonly compiledAt: ISOTimestamp | null;
  readonly approvedAt: ISOTimestamp | null;
  readonly narrative: string | null;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly findings: readonly ConditionalSurveyFinding[];
  readonly actionPlans: readonly ConditionalSurveyActionPlan[];
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId;
  readonly updatedBy: UserId;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface ConditionalSurveyRepository {
  findById(
    id: ConditionalSurveyId,
    tenantId: TenantId
  ): Promise<ConditionalSurvey | null>;
  create(survey: ConditionalSurvey): Promise<ConditionalSurvey>;
  update(survey: ConditionalSurvey): Promise<ConditionalSurvey>;
  addFinding(
    finding: ConditionalSurveyFinding
  ): Promise<ConditionalSurveyFinding>;
  addActionPlan(
    plan: ConditionalSurveyActionPlan
  ): Promise<ConditionalSurveyActionPlan>;
  updateActionPlan(
    plan: ConditionalSurveyActionPlan
  ): Promise<ConditionalSurveyActionPlan>;
}

// ============================================================================
// Errors
// ============================================================================

export const ConditionalSurveyServiceError = {
  SURVEY_NOT_FOUND: 'SURVEY_NOT_FOUND',
  FINDING_NOT_FOUND: 'FINDING_NOT_FOUND',
  ACTION_PLAN_NOT_FOUND: 'ACTION_PLAN_NOT_FOUND',
  INVALID_STATUS: 'INVALID_STATUS',
  INVALID_INPUT: 'INVALID_INPUT',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
} as const;

export type ConditionalSurveyServiceErrorCode =
  (typeof ConditionalSurveyServiceError)[keyof typeof ConditionalSurveyServiceError];

export interface ConditionalSurveyServiceErrorResult {
  code: ConditionalSurveyServiceErrorCode;
  message: string;
}
