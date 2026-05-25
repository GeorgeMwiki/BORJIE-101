/**
 * Timeline Event domain model
 * Captures chronological events in case history
 */

import { z } from 'zod';
import type {
  TenantId,
  UserId,
  ISOTimestamp,
  Brand,
} from '../common/types';
import {
  TimelineEventType,
  TimelineEventTypeSchema,
} from '../common/enums';

// ============================================================================
// Type Aliases
// ============================================================================

export type TimelineEventId = Brand<string, 'TimelineEventId'>;
export type CaseId = Brand<string, 'CaseId'>;

export function asTimelineEventId(id: string): TimelineEventId {
  return id as TimelineEventId;
}

// ============================================================================
// Timeline Event Zod Schema
// ============================================================================

export const AttachmentRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  type: z.string(),
  size: z.number().optional(),
});
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;

export const TimelineEventSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  caseId: z.string(),
  
  // Event details
  eventType: TimelineEventTypeSchema,
  title: z.string(),
  description: z.string().nullable(),
  
  // Change tracking
  previousValue: z.unknown().nullable(),
  newValue: z.unknown().nullable(),
  
  // Actor
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  actorType: z.enum(['user', 'system', 'customer', 'external']).default('user'),
  
  // Visibility
  isInternal: z.boolean().default(false),
  isCustomerVisible: z.boolean().default(true),
  
  // Attachments
  attachments: z.array(AttachmentRefSchema).default([]),
  
  // Timing
  occurredAt: z.string().datetime(),
  
  // Metadata
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type TimelineEventData = z.infer<typeof TimelineEventSchema>;

// ============================================================================
// Timeline Event Interface
// ============================================================================

export interface TimelineEvent {
  readonly id: TimelineEventId;
  readonly tenantId: TenantId;
  readonly caseId: CaseId;
  
  readonly eventType: TimelineEventType;
  readonly title: string;
  readonly description: string | null;
  
  readonly previousValue: unknown | null;
  readonly newValue: unknown | null;
  
  readonly actorId: UserId | null;
  readonly actorName: string | null;
  readonly actorType: 'user' | 'system' | 'customer' | 'external';
  
  readonly isInternal: boolean;
  readonly isCustomerVisible: boolean;
  
  readonly attachments: readonly AttachmentRef[];
  
  readonly occurredAt: ISOTimestamp;
  
  readonly metadata: Record<string, unknown>;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createTimelineEvent(
  id: TimelineEventId,
  data: {
    tenantId: TenantId;
    caseId: CaseId;
    eventType: TimelineEventType;
    title: string;
    description?: string;
    previousValue?: unknown;
    newValue?: unknown;
    actorId?: UserId;
    actorName?: string;
    actorType?: 'user' | 'system' | 'customer' | 'external';
    isInternal?: boolean;
    isCustomerVisible?: boolean;
    attachments?: AttachmentRef[];
    occurredAt?: Date;
  }
): TimelineEvent {
  return {
    id,
    tenantId: data.tenantId,
    caseId: data.caseId,
    
    eventType: data.eventType,
    title: data.title,
    description: data.description ?? null,
    
    previousValue: data.previousValue ?? null,
    newValue: data.newValue ?? null,
    
    actorId: data.actorId ?? null,
    actorName: data.actorName ?? null,
    actorType: data.actorType ?? 'user',
    
    isInternal: data.isInternal ?? false,
    isCustomerVisible: data.isCustomerVisible ?? true,
    
    attachments: data.attachments ?? [],
    
    occurredAt: (data.occurredAt ?? new Date()).toISOString(),
    
    metadata: {},
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

export function createCaseCreatedEvent(
  id: TimelineEventId,
  tenantId: TenantId,
  caseId: CaseId,
  caseTitle: string,
  createdBy: UserId,
  createdByName: string
): TimelineEvent {
  return createTimelineEvent(id, {
    tenantId,
    caseId,
    eventType: 'case_created',
    title: 'Case Created',
    description: `Case "${caseTitle}" was created`,
    actorId: createdBy,
    actorName: createdByName,
    actorType: 'user',
  });
}

export function createStatusChangedEvent(
  id: TimelineEventId,
  tenantId: TenantId,
  caseId: CaseId,
  previousStatus: string,
  newStatus: string,
  changedBy: UserId,
  changedByName: string,
  reason?: string
): TimelineEvent {
  return createTimelineEvent(id, {
    tenantId,
    caseId,
    eventType: 'status_changed',
    title: 'Status Changed',
    description: reason ?? `Status changed from "${previousStatus}" to "${newStatus}"`,
    previousValue: previousStatus,
    newValue: newStatus,
    actorId: changedBy,
    actorName: changedByName,
    actorType: 'user',
  });
}

export function createEscalationEvent(
  id: TimelineEventId,
  tenantId: TenantId,
  caseId: CaseId,
  escalatedTo: string,
  reason: string,
  escalatedBy: UserId,
  escalatedByName: string
): TimelineEvent {
  return createTimelineEvent(id, {
    tenantId,
    caseId,
    eventType: 'escalated',
    title: 'Case Escalated',
    description: `Case escalated to ${escalatedTo}: ${reason}`,
    actorId: escalatedBy,
    actorName: escalatedByName,
    actorType: 'user',
  });
}

export function createSystemEvent(
  id: TimelineEventId,
  tenantId: TenantId,
  caseId: CaseId,
  eventType: TimelineEventType,
  title: string,
  description?: string
): TimelineEvent {
  return createTimelineEvent(id, {
    tenantId,
    caseId,
    eventType,
    title,
    description,
    actorType: 'system',
    actorName: 'System',
    isCustomerVisible: false,
  });
}
