/**
 * Maintenance Request domain model
 * Represents customer-initiated maintenance requests
 */

import { z } from 'zod';
import type {
  TenantId,
  CustomerId,
  LeaseId,
  PropertyId,
  UnitId,
  UserId,
  MaintenanceRequestId,
  WorkOrderId,
  EntityMetadata,
  SoftDeletable,
  ISOTimestamp,
} from '../common/types';

// ============================================================================
// Enums and Schemas
// ============================================================================

export const MaintenanceRequestStatusSchema = z.enum([
  'submitted',
  'acknowledged',
  'triaged',
  'scheduled',
  'in_progress',
  'pending_parts',
  'pending_approval',
  'completed',
  'cancelled',
  'rejected',
]);
export type MaintenanceRequestStatus = z.infer<typeof MaintenanceRequestStatusSchema>;

export const MaintenanceRequestPrioritySchema = z.enum([
  'low',
  'medium',
  'high',
  'urgent',
  'emergency',
]);
export type MaintenanceRequestPriority = z.infer<typeof MaintenanceRequestPrioritySchema>;

export const MaintenanceRequestCategorySchema = z.enum([
  'plumbing',
  'electrical',
  'hvac',
  'appliance',
  'structural',
  'pest_control',
  'security',
  'cleaning',
  'landscaping',
  'painting',
  'flooring',
  'doors_windows',
  'locks_keys',
  'general',
  'other',
]);
export type MaintenanceRequestCategory = z.infer<typeof MaintenanceRequestCategorySchema>;

export const MaintenanceRequestSourceSchema = z.enum([
  'tenant_portal',
  'tenant_app',
  'phone_call',
  'email',
  'whatsapp',
  'in_person',
  'inspection',
  'staff_initiated',
  'automated',
]);
export type MaintenanceRequestSource = z.infer<typeof MaintenanceRequestSourceSchema>;

export const AttachmentSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  fileType: z.string(),
  fileSize: z.number(),
  url: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  uploadedAt: z.string().datetime(),
  uploadedBy: z.string(),
  description: z.string().optional(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const MaintenanceRequestSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),
  propertyId: z.string(),
  unitId: z.string().optional(),
  leaseId: z.string().optional(),
  workOrderId: z.string().optional(),
  
  // Identity
  requestNumber: z.string(),
  
  // Type and status
  category: MaintenanceRequestCategorySchema,
  status: MaintenanceRequestStatusSchema,
  priority: MaintenanceRequestPrioritySchema,
  source: MaintenanceRequestSourceSchema,
  
  // Description
  title: z.string().max(200),
  description: z.string(),
  
  // Location
  locationInUnit: z.string().optional(),
  accessInstructions: z.string().optional(),
  
  // Availability
  preferredDate: z.string().datetime().optional(),
  preferredTimeStart: z.string().optional(),
  preferredTimeEnd: z.string().optional(),
  alternateDate: z.string().datetime().optional(),
  tenantAvailability: z.string().optional(),
  
  // Permission
  permissionToEnter: z.boolean().default(false),
  petInUnit: z.boolean().default(false),
  petDetails: z.string().optional(),
  
  // Attachments
  attachments: z.array(AttachmentSchema).default([]),
  
  // AI triage
  aiTriageScore: z.number().optional(),
  aiSuggestedPriority: MaintenanceRequestPrioritySchema.optional(),
  aiSuggestedCategory: MaintenanceRequestCategorySchema.optional(),
  aiNotes: z.string().optional(),
  
  // Response
  acknowledgedAt: z.string().datetime().optional(),
  acknowledgedBy: z.string().optional(),
  
  // Scheduling
  scheduledDate: z.string().datetime().optional(),
  scheduledTimeStart: z.string().optional(),
  scheduledTimeEnd: z.string().optional(),
  
  // Completion
  completedAt: z.string().datetime().optional(),
  completedBy: z.string().optional(),
  resolutionNotes: z.string().optional(),
  customerSatisfactionRating: z.number().min(1).max(5).optional(),
  customerFeedback: z.string().optional(),
  
  // Cancellation/Rejection
  cancelledAt: z.string().datetime().optional(),
  cancelledBy: z.string().optional(),
  cancellationReason: z.string().optional(),
  rejectedAt: z.string().datetime().optional(),
  rejectedBy: z.string().optional(),
  rejectionReason: z.string().optional(),
  
  // Notes
  internalNotes: z.string().optional(),
  
  // Metadata
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type MaintenanceRequestData = z.infer<typeof MaintenanceRequestSchema>;

// ============================================================================
// Maintenance Request Interface
// ============================================================================

export interface MaintenanceRequest extends EntityMetadata, SoftDeletable {
  readonly id: MaintenanceRequestId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly propertyId: PropertyId;
  readonly unitId: UnitId | null;
  readonly leaseId: LeaseId | null;
  readonly workOrderId: WorkOrderId | null;
  
  readonly requestNumber: string;
  
  readonly category: MaintenanceRequestCategory;
  readonly status: MaintenanceRequestStatus;
  readonly priority: MaintenanceRequestPriority;
  readonly source: MaintenanceRequestSource;
  
  readonly title: string;
  readonly description: string;
  
  readonly locationInUnit: string | null;
  readonly accessInstructions: string | null;
  
  readonly preferredDate: ISOTimestamp | null;
  readonly preferredTimeStart: string | null;
  readonly preferredTimeEnd: string | null;
  readonly alternateDate: ISOTimestamp | null;
  readonly tenantAvailability: string | null;
  
  readonly permissionToEnter: boolean;
  readonly petInUnit: boolean;
  readonly petDetails: string | null;
  
  readonly attachments: readonly Attachment[];
  
  readonly aiTriageScore: number | null;
  readonly aiSuggestedPriority: MaintenanceRequestPriority | null;
  readonly aiSuggestedCategory: MaintenanceRequestCategory | null;
  readonly aiNotes: string | null;
  
  readonly acknowledgedAt: ISOTimestamp | null;
  readonly acknowledgedBy: UserId | null;
  
  readonly scheduledDate: ISOTimestamp | null;
  readonly scheduledTimeStart: string | null;
  readonly scheduledTimeEnd: string | null;
  
  readonly completedAt: ISOTimestamp | null;
  readonly completedBy: UserId | null;
  readonly resolutionNotes: string | null;
  readonly customerSatisfactionRating: number | null;
  readonly customerFeedback: string | null;
  
  readonly cancelledAt: ISOTimestamp | null;
  readonly cancelledBy: UserId | null;
  readonly cancellationReason: string | null;
  readonly rejectedAt: ISOTimestamp | null;
  readonly rejectedBy: UserId | null;
  readonly rejectionReason: string | null;
  
  readonly internalNotes: string | null;
  
  readonly metadata: Record<string, unknown>;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createMaintenanceRequest(
  id: MaintenanceRequestId,
  data: {
    tenantId: TenantId;
    customerId: CustomerId;
    propertyId: PropertyId;
    requestNumber: string;
    category: MaintenanceRequestCategory;
    priority: MaintenanceRequestPriority;
    source: MaintenanceRequestSource;
    title: string;
    description: string;
    unitId?: UnitId;
    leaseId?: LeaseId;
    locationInUnit?: string;
    accessInstructions?: string;
    preferredDate?: Date;
    preferredTimeStart?: string;
    preferredTimeEnd?: string;
    alternateDate?: Date;
    tenantAvailability?: string;
    permissionToEnter?: boolean;
    petInUnit?: boolean;
    petDetails?: string;
    attachments?: Attachment[];
  },
  createdBy: UserId
): MaintenanceRequest {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    customerId: data.customerId,
    propertyId: data.propertyId,
    unitId: data.unitId ?? null,
    leaseId: data.leaseId ?? null,
    workOrderId: null,
    
    requestNumber: data.requestNumber,
    
    category: data.category,
    status: 'submitted',
    priority: data.priority,
    source: data.source,
    
    title: data.title,
    description: data.description,
    
    locationInUnit: data.locationInUnit ?? null,
    accessInstructions: data.accessInstructions ?? null,
    
    preferredDate: data.preferredDate?.toISOString() ?? null,
    preferredTimeStart: data.preferredTimeStart ?? null,
    preferredTimeEnd: data.preferredTimeEnd ?? null,
    alternateDate: data.alternateDate?.toISOString() ?? null,
    tenantAvailability: data.tenantAvailability ?? null,
    
    permissionToEnter: data.permissionToEnter ?? false,
    petInUnit: data.petInUnit ?? false,
    petDetails: data.petDetails ?? null,
    
    attachments: data.attachments ?? [],
    
    aiTriageScore: null,
    aiSuggestedPriority: null,
    aiSuggestedCategory: null,
    aiNotes: null,
    
    acknowledgedAt: null,
    acknowledgedBy: null,
    
    scheduledDate: null,
    scheduledTimeStart: null,
    scheduledTimeEnd: null,
    
    completedAt: null,
    completedBy: null,
    resolutionNotes: null,
    customerSatisfactionRating: null,
    customerFeedback: null,
    
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    
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

export function acknowledgeRequest(
  request: MaintenanceRequest,
  acknowledgedBy: UserId
): MaintenanceRequest {
  if (request.status !== 'submitted') {
    throw new Error('Can only acknowledge submitted requests');
  }
  const now = new Date().toISOString();
  return {
    ...request,
    status: 'acknowledged',
    acknowledgedAt: now,
    acknowledgedBy,
    updatedAt: now,
    updatedBy: acknowledgedBy,
  };
}

export function triageRequest(
  request: MaintenanceRequest,
  triageData: {
    aiTriageScore?: number;
    aiSuggestedPriority?: MaintenanceRequestPriority;
    aiSuggestedCategory?: MaintenanceRequestCategory;
    aiNotes?: string;
  },
  updatedBy: UserId
): MaintenanceRequest {
  return {
    ...request,
    status: 'triaged',
    aiTriageScore: triageData.aiTriageScore ?? request.aiTriageScore,
    aiSuggestedPriority: triageData.aiSuggestedPriority ?? request.aiSuggestedPriority,
    aiSuggestedCategory: triageData.aiSuggestedCategory ?? request.aiSuggestedCategory,
    aiNotes: triageData.aiNotes ?? request.aiNotes,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function scheduleRequest(
  request: MaintenanceRequest,
  scheduledDate: Date,
  scheduledTimeStart: string,
  scheduledTimeEnd: string,
  updatedBy: UserId
): MaintenanceRequest {
  return {
    ...request,
    status: 'scheduled',
    scheduledDate: scheduledDate.toISOString(),
    scheduledTimeStart,
    scheduledTimeEnd,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function linkWorkOrder(
  request: MaintenanceRequest,
  workOrderId: WorkOrderId,
  updatedBy: UserId
): MaintenanceRequest {
  return {
    ...request,
    workOrderId,
    status: 'in_progress',
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function completeRequest(
  request: MaintenanceRequest,
  resolutionNotes: string,
  updatedBy: UserId
): MaintenanceRequest {
  const now = new Date().toISOString();
  return {
    ...request,
    status: 'completed',
    completedAt: now,
    completedBy: updatedBy,
    resolutionNotes,
    updatedAt: now,
    updatedBy,
  };
}

export function addCustomerFeedback(
  request: MaintenanceRequest,
  rating: number,
  feedback: string | null,
  updatedBy: UserId
): MaintenanceRequest {
  if (request.status !== 'completed') {
    throw new Error('Can only add feedback to completed requests');
  }
  return {
    ...request,
    customerSatisfactionRating: rating,
    customerFeedback: feedback,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function cancelRequest(
  request: MaintenanceRequest,
  reason: string,
  updatedBy: UserId
): MaintenanceRequest {
  if (request.status === 'completed' || request.status === 'cancelled') {
    throw new Error('Cannot cancel completed or already cancelled requests');
  }
  const now = new Date().toISOString();
  return {
    ...request,
    status: 'cancelled',
    cancelledAt: now,
    cancelledBy: updatedBy,
    cancellationReason: reason,
    updatedAt: now,
    updatedBy,
  };
}

export function rejectRequest(
  request: MaintenanceRequest,
  reason: string,
  updatedBy: UserId
): MaintenanceRequest {
  if (request.status === 'completed' || request.status === 'cancelled') {
    throw new Error('Cannot reject completed or cancelled requests');
  }
  const now = new Date().toISOString();
  return {
    ...request,
    status: 'rejected',
    rejectedAt: now,
    rejectedBy: updatedBy,
    rejectionReason: reason,
    updatedAt: now,
    updatedBy,
  };
}

export function generateRequestNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}
