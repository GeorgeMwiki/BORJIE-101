/**
 * FAR (Fitness-for-Assessment Review) Domain Types (NEW 16)
 */

import type {
  TenantId,
  UserId,
  PropertyId,
  UnitId,
  ISOTimestamp,
} from '@borjie/domain-models';

// ============================================================================
// Branded IDs
// ============================================================================

export type AssetComponentId = string & { __brand: 'AssetComponentId' };
export function asAssetComponentId(id: string): AssetComponentId {
  return id as AssetComponentId;
}

export type FarAssignmentId = string & { __brand: 'FarAssignmentId' };
export function asFarAssignmentId(id: string): FarAssignmentId {
  return id as FarAssignmentId;
}

export type ConditionCheckEventId = string & {
  __brand: 'ConditionCheckEventId';
};
export function asConditionCheckEventId(id: string): ConditionCheckEventId {
  return id as ConditionCheckEventId;
}

// ============================================================================
// Enums
// ============================================================================

export const ASSET_COMPONENT_STATUSES = [
  'active',
  'monitoring',
  'needs_repair',
  'decommissioned',
] as const;
export type AssetComponentStatus = (typeof ASSET_COMPONENT_STATUSES)[number];

export const ASSET_COMPONENT_CONDITIONS = [
  'excellent',
  'good',
  'fair',
  'poor',
  'critical',
] as const;
export type AssetComponentCondition =
  (typeof ASSET_COMPONENT_CONDITIONS)[number];

export const FAR_CHECK_FREQUENCIES = [
  'weekly',
  'monthly',
  'quarterly',
  'biannual',
  'annual',
  'ad_hoc',
] as const;
export type FarCheckFrequency = (typeof FAR_CHECK_FREQUENCIES)[number];

export const FAR_ASSIGNMENT_STATUSES = [
  'active',
  'paused',
  'cancelled',
  'completed',
] as const;
export type FarAssignmentStatus = (typeof FAR_ASSIGNMENT_STATUSES)[number];

export const CONDITION_CHECK_OUTCOMES = [
  'pass',
  'warning',
  'fail',
  'skipped',
] as const;
export type ConditionCheckOutcome = (typeof CONDITION_CHECK_OUTCOMES)[number];

// ============================================================================
// Notify Recipient
// ============================================================================

export interface NotifyRecipient {
  readonly role: 'landlord' | 'manager' | 'vendor' | 'tenant' | 'other';
  readonly userId: UserId | null;
  readonly email: string | null;
  readonly phone: string | null;
}

// ============================================================================
// Entities
// ============================================================================

export interface AssetComponent {
  readonly id: AssetComponentId;
  readonly tenantId: TenantId;
  readonly propertyId: PropertyId;
  readonly unitId: UnitId | null;
  readonly code: string;
  readonly name: string;
  readonly category: string | null;
  readonly manufacturer: string | null;
  readonly modelNumber: string | null;
  readonly serialNumber: string | null;
  readonly installedAt: ISOTimestamp | null;
  readonly expectedLifespanMonths: number | null;
  readonly status: AssetComponentStatus;
  readonly currentCondition: AssetComponentCondition;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId;
  readonly updatedBy: UserId;
}

export interface FarAssignment {
  readonly id: FarAssignmentId;
  readonly tenantId: TenantId;
  readonly componentId: AssetComponentId;
  readonly assignedTo: UserId | null;
  readonly frequency: FarCheckFrequency;
  readonly status: FarAssignmentStatus;
  readonly triggerRules: Readonly<Record<string, unknown>>;
  readonly firstCheckDueAt: ISOTimestamp | null;
  readonly nextCheckDueAt: ISOTimestamp | null;
  readonly lastCheckedAt: ISOTimestamp | null;
  readonly notifyRecipients: readonly NotifyRecipient[];
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId;
  readonly updatedBy: UserId;
}

export interface ConditionCheckEvent {
  readonly id: ConditionCheckEventId;
  readonly tenantId: TenantId;
  readonly farAssignmentId: FarAssignmentId;
  readonly componentId: AssetComponentId;
  readonly performedBy: UserId | null;
  readonly dueAt: ISOTimestamp | null;
  readonly performedAt: ISOTimestamp | null;
  readonly outcome: ConditionCheckOutcome;
  readonly conditionAfter: AssetComponentCondition | null;
  readonly notes: string | null;
  readonly photos: readonly string[];
  readonly measurements: Readonly<Record<string, unknown>>;
  readonly notificationsLog: readonly {
    readonly recipient: NotifyRecipient;
    readonly method: 'email' | 'sms' | 'push' | 'in_app';
    readonly sentAt: ISOTimestamp;
    readonly status: 'queued' | 'sent' | 'failed';
  }[];
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

// ============================================================================
// Repository
// ============================================================================

export interface FarRepository {
  findComponentById(
    id: AssetComponentId,
    tenantId: TenantId
  ): Promise<AssetComponent | null>;
  findAssignmentById(
    id: FarAssignmentId,
    tenantId: TenantId
  ): Promise<FarAssignment | null>;
  createComponent(input: AssetComponent): Promise<AssetComponent>;
  createAssignment(input: FarAssignment): Promise<FarAssignment>;
  updateAssignment(input: FarAssignment): Promise<FarAssignment>;
  createCheckEvent(input: ConditionCheckEvent): Promise<ConditionCheckEvent>;
  findDueAssignments(
    tenantId: TenantId | null,
    now: ISOTimestamp
  ): Promise<readonly FarAssignment[]>;
  findScheduledChecks(
    tenantId: TenantId,
    componentId?: AssetComponentId
  ): Promise<readonly ConditionCheckEvent[]>;
}

// ============================================================================
// Errors
// ============================================================================

export const FarServiceError = {
  COMPONENT_NOT_FOUND: 'COMPONENT_NOT_FOUND',
  ASSIGNMENT_NOT_FOUND: 'ASSIGNMENT_NOT_FOUND',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_STATUS: 'INVALID_STATUS',
} as const;

export type FarServiceErrorCode =
  (typeof FarServiceError)[keyof typeof FarServiceError];

export interface FarServiceErrorResult {
  code: FarServiceErrorCode;
  message: string;
}
