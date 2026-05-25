/**
 * Case domain model
 * Represents legal cases, disputes, and complaint tracking
 */

import { z } from 'zod';
import type {
  TenantId,
  UserId,
  PropertyId,
  UnitId,
  CustomerId,
  LeaseId,
  EntityMetadata,
  ISOTimestamp,
  Brand,
} from '../common/types';
import {
  CaseType,
  CaseTypeSchema,
  CaseSeverity,
  CaseSeveritySchema,
  CaseStatus,
  CaseStatusSchema,
  CurrencyCode,
  CurrencyCodeSchema,
} from '../common/enums';

// ============================================================================
// Type Aliases
// ============================================================================

export type CaseId = Brand<string, 'CaseId'>;

export function asCaseId(id: string): CaseId {
  return id as CaseId;
}

// ============================================================================
// Nested Schemas
// ============================================================================

export const SlaDetailsSchema = z.object({
  responseDeadline: z.string().datetime().nullable(),
  resolutionDeadline: z.string().datetime().nullable(),
  responseBreached: z.boolean().default(false),
  resolutionBreached: z.boolean().default(false),
  firstResponseAt: z.string().datetime().nullable(),
  hoursToFirstResponse: z.number().nullable(),
  hoursToResolution: z.number().nullable(),
});
export type SlaDetails = z.infer<typeof SlaDetailsSchema>;

// ============================================================================
// Case Zod Schema
// ============================================================================

export const CaseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  propertyId: z.string().nullable(),
  unitId: z.string().nullable(),
  customerId: z.string().nullable(),
  leaseId: z.string().nullable(),
  
  // Identification
  caseNumber: z.string(),
  
  // Classification
  caseType: CaseTypeSchema,
  severity: CaseSeveritySchema,
  status: CaseStatusSchema,
  
  // Details
  title: z.string(),
  description: z.string(),
  
  // Financial
  amountInDispute: z.number().nullable(),
  currency: CurrencyCodeSchema.default('USD'),
  
  // SLA tracking
  slaDetails: SlaDetailsSchema.nullable(),
  
  // Assignment
  assignedTo: z.string().nullable(),
  assignedAt: z.string().datetime().nullable(),
  assignedBy: z.string().nullable(),
  teamId: z.string().nullable(),
  
  // Escalation
  isEscalated: z.boolean().default(false),
  escalatedAt: z.string().datetime().nullable(),
  escalatedTo: z.string().nullable(),
  escalatedBy: z.string().nullable(),
  escalationReason: z.string().nullable(),
  escalationLevel: z.number().default(0),
  
  // Parent case (for linked/child cases)
  parentCaseId: z.string().nullable(),
  
  // Tags
  tags: z.array(z.string()).default([]),
  
  // Resolution
  resolutionId: z.string().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedBy: z.string().nullable(),
  resolutionSummary: z.string().nullable(),
  
  // Closure
  closedAt: z.string().datetime().nullable(),
  closedBy: z.string().nullable(),
  closeReason: z.string().nullable(),
  
  // Customer satisfaction
  customerSatisfactionRating: z.number().min(1).max(5).nullable(),
  customerSatisfactionFeedback: z.string().nullable(),
  
  // Internal notes
  internalNotes: z.string().nullable(),
  
  // Metadata
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type CaseData = z.infer<typeof CaseSchema>;

// ============================================================================
// Case Interface
// ============================================================================

export interface Case extends EntityMetadata {
  readonly id: CaseId;
  readonly tenantId: TenantId;
  readonly propertyId: PropertyId | null;
  readonly unitId: UnitId | null;
  readonly customerId: CustomerId | null;
  readonly leaseId: LeaseId | null;
  
  readonly caseNumber: string;
  
  readonly caseType: CaseType;
  readonly severity: CaseSeverity;
  readonly status: CaseStatus;
  
  readonly title: string;
  readonly description: string;
  
  readonly amountInDispute: number | null;
  readonly currency: CurrencyCode;
  
  readonly slaDetails: SlaDetails | null;
  
  readonly assignedTo: UserId | null;
  readonly assignedAt: ISOTimestamp | null;
  readonly assignedBy: UserId | null;
  readonly teamId: string | null;
  
  readonly isEscalated: boolean;
  readonly escalatedAt: ISOTimestamp | null;
  readonly escalatedTo: UserId | null;
  readonly escalatedBy: UserId | null;
  readonly escalationReason: string | null;
  readonly escalationLevel: number;
  
  readonly parentCaseId: CaseId | null;
  
  readonly tags: readonly string[];
  
  readonly resolutionId: string | null;
  readonly resolvedAt: ISOTimestamp | null;
  readonly resolvedBy: UserId | null;
  readonly resolutionSummary: string | null;
  
  readonly closedAt: ISOTimestamp | null;
  readonly closedBy: UserId | null;
  readonly closeReason: string | null;
  
  readonly customerSatisfactionRating: number | null;
  readonly customerSatisfactionFeedback: string | null;
  
  readonly internalNotes: string | null;
  
  readonly metadata: Record<string, unknown>;
  
  // Soft delete
  readonly deletedAt: ISOTimestamp | null;
  readonly deletedBy: UserId | null;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createCase(
  id: CaseId,
  data: {
    tenantId: TenantId;
    caseNumber: string;
    caseType: CaseType;
    severity: CaseSeverity;
    title: string;
    description: string;
    propertyId?: PropertyId;
    unitId?: UnitId;
    customerId?: CustomerId;
    leaseId?: LeaseId;
    amountInDispute?: number;
    currency?: CurrencyCode;
    tags?: string[];
    assignTo?: UserId;
    responseDeadlineHours?: number;
    resolutionDeadlineHours?: number;
  },
  createdBy: UserId
): Case {
  const now = new Date().toISOString();
  const nowDate = new Date();
  
  // Calculate SLA deadlines based on severity
  const defaultResponseHours = data.responseDeadlineHours ?? getSeverityResponseHours(data.severity);
  const defaultResolutionHours = data.resolutionDeadlineHours ?? getSeverityResolutionHours(data.severity);
  
  const responseDeadline = new Date(nowDate.getTime() + defaultResponseHours * 60 * 60 * 1000);
  const resolutionDeadline = new Date(nowDate.getTime() + defaultResolutionHours * 60 * 60 * 1000);

  return {
    id,
    tenantId: data.tenantId,
    propertyId: data.propertyId ?? null,
    unitId: data.unitId ?? null,
    customerId: data.customerId ?? null,
    leaseId: data.leaseId ?? null,
    
    caseNumber: data.caseNumber,
    
    caseType: data.caseType,
    severity: data.severity,
    status: 'open',
    
    title: data.title,
    description: data.description,
    
    amountInDispute: data.amountInDispute ?? null,
    currency: data.currency ?? 'USD',
    
    slaDetails: {
      responseDeadline: responseDeadline.toISOString(),
      resolutionDeadline: resolutionDeadline.toISOString(),
      responseBreached: false,
      resolutionBreached: false,
      firstResponseAt: null,
      hoursToFirstResponse: null,
      hoursToResolution: null,
    },
    
    assignedTo: data.assignTo ?? null,
    assignedAt: data.assignTo ? now : null,
    assignedBy: data.assignTo ? createdBy : null,
    teamId: null,
    
    isEscalated: false,
    escalatedAt: null,
    escalatedTo: null,
    escalatedBy: null,
    escalationReason: null,
    escalationLevel: 0,
    
    parentCaseId: null,
    
    tags: data.tags ?? [],
    
    resolutionId: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionSummary: null,
    
    closedAt: null,
    closedBy: null,
    closeReason: null,
    
    customerSatisfactionRating: null,
    customerSatisfactionFeedback: null,
    
    internalNotes: null,
    
    metadata: {},
    
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
    
    deletedAt: null,
    deletedBy: null,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function getSeverityResponseHours(severity: CaseSeverity): number {
  switch (severity) {
    case 'urgent':
    case 'critical':
      return 2;
    case 'high':
      return 8;
    case 'medium':
      return 24;
    case 'low':
      return 48;
    default:
      return 24;
  }
}

export function getSeverityResolutionHours(severity: CaseSeverity): number {
  switch (severity) {
    case 'urgent':
    case 'critical':
      return 24;
    case 'high':
      return 72;
    case 'medium':
      return 168; // 1 week
    case 'low':
      return 336; // 2 weeks
    default:
      return 168;
  }
}

export function assignCase(
  caseItem: Case,
  assignTo: UserId,
  assignedBy: UserId
): Case {
  const now = new Date().toISOString();
  return {
    ...caseItem,
    assignedTo: assignTo,
    assignedAt: now,
    assignedBy,
    status: caseItem.status === 'open' ? 'investigating' : caseItem.status,
    updatedAt: now,
    updatedBy: assignedBy,
  };
}

export function recordFirstResponse(caseItem: Case, updatedBy: UserId): Case {
  if (!caseItem.slaDetails || caseItem.slaDetails.firstResponseAt) {
    return caseItem;
  }
  
  const now = new Date();
  const nowIso = now.toISOString();
  const createdAt = new Date(caseItem.createdAt);
  const hoursToResponse = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
  const responseBreached = caseItem.slaDetails.responseDeadline
    ? now > new Date(caseItem.slaDetails.responseDeadline)
    : false;

  return {
    ...caseItem,
    slaDetails: {
      ...caseItem.slaDetails,
      firstResponseAt: nowIso,
      hoursToFirstResponse: Math.round(hoursToResponse * 100) / 100,
      responseBreached,
    },
    updatedAt: nowIso,
    updatedBy,
  };
}

export function escalateCase(
  caseItem: Case,
  escalateTo: UserId,
  reason: string,
  escalatedBy: UserId
): Case {
  const now = new Date().toISOString();
  return {
    ...caseItem,
    status: 'escalated',
    isEscalated: true,
    escalatedAt: now,
    escalatedTo: escalateTo,
    escalatedBy,
    escalationReason: reason,
    escalationLevel: caseItem.escalationLevel + 1,
    updatedAt: now,
    updatedBy: escalatedBy,
  };
}

export function updateCaseStatus(
  caseItem: Case,
  newStatus: CaseStatus,
  updatedBy: UserId
): Case {
  const now = new Date().toISOString();
  return {
    ...caseItem,
    status: newStatus,
    updatedAt: now,
    updatedBy,
  };
}

export function resolveCase(
  caseItem: Case,
  data: {
    resolutionId: string;
    resolutionSummary: string;
  },
  resolvedBy: UserId
): Case {
  const now = new Date();
  const nowIso = now.toISOString();
  const createdAt = new Date(caseItem.createdAt);
  const hoursToResolution = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
  const resolutionBreached = caseItem.slaDetails?.resolutionDeadline
    ? now > new Date(caseItem.slaDetails.resolutionDeadline)
    : false;

  return {
    ...caseItem,
    status: 'resolved',
    resolutionId: data.resolutionId,
    resolvedAt: nowIso,
    resolvedBy,
    resolutionSummary: data.resolutionSummary,
    slaDetails: caseItem.slaDetails
      ? {
          ...caseItem.slaDetails,
          hoursToResolution: Math.round(hoursToResolution * 100) / 100,
          resolutionBreached,
        }
      : null,
    updatedAt: nowIso,
    updatedBy: resolvedBy,
  };
}

export function closeCase(
  caseItem: Case,
  reason: string,
  closedBy: UserId
): Case {
  if (caseItem.status !== 'resolved') {
    throw new Error('Can only close resolved cases');
  }
  const now = new Date().toISOString();
  return {
    ...caseItem,
    status: 'closed',
    closedAt: now,
    closedBy,
    closeReason: reason,
    updatedAt: now,
    updatedBy: closedBy,
  };
}

export function recordSatisfaction(
  caseItem: Case,
  rating: number,
  feedback: string | undefined,
  updatedBy: UserId
): Case {
  const now = new Date().toISOString();
  return {
    ...caseItem,
    customerSatisfactionRating: rating,
    customerSatisfactionFeedback: feedback ?? null,
    updatedAt: now,
    updatedBy,
  };
}

export function withdrawCase(caseItem: Case, updatedBy: UserId): Case {
  const now = new Date().toISOString();
  return {
    ...caseItem,
    status: 'withdrawn',
    closedAt: now,
    closedBy: updatedBy,
    closeReason: 'Withdrawn by customer',
    updatedAt: now,
    updatedBy,
  };
}

export function isSlaBreached(caseItem: Case): { response: boolean; resolution: boolean } {
  if (!caseItem.slaDetails) return { response: false, resolution: false };
  
  const now = new Date();
  const responseBreached = Boolean(
    caseItem.slaDetails.responseBreached ||
      (!caseItem.slaDetails.firstResponseAt &&
        caseItem.slaDetails.responseDeadline &&
        now > new Date(caseItem.slaDetails.responseDeadline))
  );

  const resolutionBreached = Boolean(
    caseItem.slaDetails.resolutionBreached ||
      (!caseItem.resolvedAt &&
        caseItem.slaDetails.resolutionDeadline &&
        now > new Date(caseItem.slaDetails.resolutionDeadline))
  );

  return { response: responseBreached, resolution: resolutionBreached };
}

export function generateCaseNumber(
  tenantCode: string,
  caseType: CaseType,
  sequenceNumber: number
): string {
  const typePrefix = caseType.slice(0, 3).toUpperCase();
  const year = new Date().getFullYear().toString().slice(-2);
  const paddedSequence = sequenceNumber.toString().padStart(5, '0');
  return `${tenantCode}-${typePrefix}-${year}${paddedSequence}`;
}
