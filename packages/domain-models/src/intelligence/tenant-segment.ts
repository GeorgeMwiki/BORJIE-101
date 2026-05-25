/**
 * Tenant Segment domain model
 * Dynamic customer segmentation for AI-native personalization
 */

import { z } from 'zod';
import type { Brand, TenantId, UserId, EntityMetadata, ISOTimestamp } from '../common/types';
import type { CustomerId } from '../payments/payment-intent';
import {
  SegmentType,
  SegmentTypeSchema,
  SegmentStatus,
  SegmentStatusSchema,
} from '../common/enums';

// ============================================================================
// Type Aliases
// ============================================================================

export type TenantSegmentId = Brand<string, 'TenantSegmentId'>;
export type CustomerSegmentMembershipId = Brand<string, 'CustomerSegmentMembershipId'>;

export function asTenantSegmentId(id: string): TenantSegmentId {
  return id as TenantSegmentId;
}

export function asCustomerSegmentMembershipId(id: string): CustomerSegmentMembershipId {
  return id as CustomerSegmentMembershipId;
}

// ============================================================================
// Nested Types
// ============================================================================

/** Segment criteria definition */
export interface SegmentCriteria {
  readonly field: string;
  readonly operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'contains' | 'between';
  readonly value: unknown;
  readonly logicalOperator?: 'AND' | 'OR';
}

export const SegmentCriteriaSchema = z.object({
  field: z.string(),
  operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'contains', 'between']),
  value: z.unknown(),
  logicalOperator: z.enum(['AND', 'OR']).optional(),
});

/** Default action for segment */
export interface SegmentDefaultAction {
  readonly actionType: string;
  readonly priority: number;
  readonly parameters: Record<string, unknown>;
  readonly cooldownDays: number;
}

export const SegmentDefaultActionSchema = z.object({
  actionType: z.string(),
  priority: z.number(),
  parameters: z.record(z.string(), z.unknown()),
  cooldownDays: z.number(),
});

/** Policy override for segment */
export interface SegmentPolicyOverride {
  readonly policyKey: string;
  readonly value: unknown;
  readonly reason: string;
}

export const SegmentPolicyOverrideSchema = z.object({
  policyKey: z.string(),
  value: z.unknown(),
  reason: z.string(),
});

// ============================================================================
// Tenant Segment Zod Schema
// ============================================================================

export const TenantSegmentSchema = z.object({
  id: z.string(),
  tenantId: z.string(),

  name: z.string(),
  code: z.string(),
  description: z.string().nullable(),

  segmentType: SegmentTypeSchema,
  status: SegmentStatusSchema,

  criteria: z.array(SegmentCriteriaSchema).default([]),
  criteriaVersion: z.number().default(1),

  color: z.string().nullable(),
  icon: z.string().nullable(),
  displayOrder: z.number().default(0),

  isAutomatic: z.boolean().default(true),
  refreshIntervalHours: z.number().default(24),
  lastRefreshedAt: z.string().datetime().nullable(),

  memberCount: z.number().default(0),
  lastMemberCountAt: z.string().datetime().nullable(),

  defaultActions: z.array(SegmentDefaultActionSchema).default([]),
  policyOverrides: z.array(SegmentPolicyOverrideSchema).default([]),

  avgPaymentScore: z.number().nullable(),
  avgChurnRisk: z.number().nullable(),
  avgLifetimeValue: z.number().nullable(),
});

export type TenantSegmentData = z.infer<typeof TenantSegmentSchema>;

// ============================================================================
// Customer Segment Membership Zod Schema
// ============================================================================

export const CustomerSegmentMembershipSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),
  segmentId: z.string(),

  score: z.number().nullable(),
  confidence: z.number().nullable(),
  isPrimary: z.boolean().default(false),

  enteredAt: z.string().datetime(),
  exitedAt: z.string().datetime().nullable(),
  entryReason: z.string().nullable(),
  entrySource: z.string().nullable(),
  exitReason: z.string().nullable(),
  previousSegmentId: z.string().nullable(),
});

export type CustomerSegmentMembershipData = z.infer<typeof CustomerSegmentMembershipSchema>;

// ============================================================================
// Interfaces
// ============================================================================

export interface TenantSegment extends EntityMetadata {
  readonly id: TenantSegmentId;
  readonly tenantId: TenantId;

  readonly name: string;
  readonly code: string;
  readonly description: string | null;

  readonly segmentType: SegmentType;
  readonly status: SegmentStatus;

  readonly criteria: readonly SegmentCriteria[];
  readonly criteriaVersion: number;

  readonly color: string | null;
  readonly icon: string | null;
  readonly displayOrder: number;

  readonly isAutomatic: boolean;
  readonly refreshIntervalHours: number;
  readonly lastRefreshedAt: ISOTimestamp | null;

  readonly memberCount: number;
  readonly lastMemberCountAt: ISOTimestamp | null;

  readonly defaultActions: readonly SegmentDefaultAction[];
  readonly policyOverrides: readonly SegmentPolicyOverride[];

  readonly avgPaymentScore: number | null;
  readonly avgChurnRisk: number | null;
  readonly avgLifetimeValue: number | null;

  // Soft delete
  readonly deletedAt: ISOTimestamp | null;
  readonly deletedBy: UserId | null;
}

export interface CustomerSegmentMembership {
  readonly id: CustomerSegmentMembershipId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly segmentId: TenantSegmentId;

  readonly score: number | null;
  readonly confidence: number | null;
  readonly isPrimary: boolean;

  readonly enteredAt: ISOTimestamp;
  readonly exitedAt: ISOTimestamp | null;
  readonly entryReason: string | null;
  readonly entrySource: string | null;
  readonly exitReason: string | null;
  readonly previousSegmentId: TenantSegmentId | null;

  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createTenantSegment(
  id: TenantSegmentId,
  data: {
    tenantId: TenantId;
    name: string;
    code: string;
    segmentType: SegmentType;
    description?: string;
    criteria?: SegmentCriteria[];
    color?: string;
    icon?: string;
  },
  createdBy: UserId
): TenantSegment {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,

    name: data.name,
    code: data.code,
    description: data.description ?? null,

    segmentType: data.segmentType,
    status: 'active',

    criteria: data.criteria ?? [],
    criteriaVersion: 1,

    color: data.color ?? null,
    icon: data.icon ?? null,
    displayOrder: 0,

    isAutomatic: true,
    refreshIntervalHours: 24,
    lastRefreshedAt: null,

    memberCount: 0,
    lastMemberCountAt: null,

    defaultActions: [],
    policyOverrides: [],

    avgPaymentScore: null,
    avgChurnRisk: null,
    avgLifetimeValue: null,

    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,

    deletedAt: null,
    deletedBy: null,
  };
}

export function createCustomerSegmentMembership(
  id: CustomerSegmentMembershipId,
  data: {
    tenantId: TenantId;
    customerId: CustomerId;
    segmentId: TenantSegmentId;
    score?: number;
    confidence?: number;
    isPrimary?: boolean;
    entryReason?: string;
    entrySource?: string;
    previousSegmentId?: TenantSegmentId;
  }
): CustomerSegmentMembership {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    customerId: data.customerId,
    segmentId: data.segmentId,

    score: data.score ?? null,
    confidence: data.confidence ?? null,
    isPrimary: data.isPrimary ?? false,

    enteredAt: now,
    exitedAt: null,
    entryReason: data.entryReason ?? null,
    entrySource: data.entrySource ?? null,
    exitReason: null,
    previousSegmentId: data.previousSegmentId ?? null,

    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function updateSegmentCriteria(
  segment: TenantSegment,
  criteria: SegmentCriteria[],
  updatedBy: UserId
): TenantSegment {
  const now = new Date().toISOString();
  return {
    ...segment,
    criteria,
    criteriaVersion: segment.criteriaVersion + 1,
    updatedAt: now,
    updatedBy,
  };
}

export function updateMemberCount(
  segment: TenantSegment,
  count: number,
  analytics?: {
    avgPaymentScore?: number;
    avgChurnRisk?: number;
    avgLifetimeValue?: number;
  }
): TenantSegment {
  const now = new Date().toISOString();
  return {
    ...segment,
    memberCount: count,
    lastMemberCountAt: now,
    avgPaymentScore: analytics?.avgPaymentScore ?? segment.avgPaymentScore,
    avgChurnRisk: analytics?.avgChurnRisk ?? segment.avgChurnRisk,
    avgLifetimeValue: analytics?.avgLifetimeValue ?? segment.avgLifetimeValue,
    lastRefreshedAt: now,
    updatedAt: now,
    updatedBy: segment.updatedBy,
  };
}

export function activateSegment(segment: TenantSegment, updatedBy: UserId): TenantSegment {
  const now = new Date().toISOString();
  return {
    ...segment,
    status: 'active',
    updatedAt: now,
    updatedBy,
  };
}

export function deactivateSegment(segment: TenantSegment, updatedBy: UserId): TenantSegment {
  const now = new Date().toISOString();
  return {
    ...segment,
    status: 'inactive',
    updatedAt: now,
    updatedBy,
  };
}

export function archiveSegment(segment: TenantSegment, updatedBy: UserId): TenantSegment {
  const now = new Date().toISOString();
  return {
    ...segment,
    status: 'archived',
    deletedAt: now,
    deletedBy: updatedBy,
    updatedAt: now,
    updatedBy,
  };
}

export function addDefaultAction(
  segment: TenantSegment,
  action: SegmentDefaultAction,
  updatedBy: UserId
): TenantSegment {
  const now = new Date().toISOString();
  return {
    ...segment,
    defaultActions: [...segment.defaultActions, action],
    updatedAt: now,
    updatedBy,
  };
}

export function exitMembership(
  membership: CustomerSegmentMembership,
  reason: string
): CustomerSegmentMembership {
  const now = new Date().toISOString();
  return {
    ...membership,
    exitedAt: now,
    exitReason: reason,
    updatedAt: now,
  };
}

export function setPrimaryMembership(
  membership: CustomerSegmentMembership,
  isPrimary: boolean
): CustomerSegmentMembership {
  const now = new Date().toISOString();
  return {
    ...membership,
    isPrimary,
    updatedAt: now,
  };
}

export function isSegmentActive(segment: TenantSegment): boolean {
  return segment.status === 'active' && segment.deletedAt === null;
}

export function needsRefresh(segment: TenantSegment): boolean {
  if (!segment.lastRefreshedAt) return true;
  const lastRefresh = new Date(segment.lastRefreshedAt);
  const now = new Date();
  const hoursSinceRefresh = (now.getTime() - lastRefresh.getTime()) / (1000 * 60 * 60);
  return hoursSinceRefresh >= segment.refreshIntervalHours;
}

export function isMembershipActive(membership: CustomerSegmentMembership): boolean {
  return membership.exitedAt === null;
}
