/**
 * Dual Sign-Off domain model
 * Captures both technician and customer verification of work completion
 */

import { z } from 'zod';
import type {
  TenantId,
  UserId,
  WorkOrderId,
  CustomerId,
  EntityMetadata,
  ISOTimestamp,
  Brand,
} from '../common/types';

// ============================================================================
// Type Aliases
// ============================================================================

export type DualSignoffId = Brand<string, 'DualSignoffId'>;
export type CompletionProofId = Brand<string, 'CompletionProofId'>;

export function asDualSignoffId(id: string): DualSignoffId {
  return id as DualSignoffId;
}

// ============================================================================
// Enums and Schemas
// ============================================================================

export const DualSignoffStatusSchema = z.enum([
  'pending_technician',
  'pending_customer',
  'completed',
  'customer_refused',
  'customer_unavailable',
  'expired',
]);
export type DualSignoffStatus = z.infer<typeof DualSignoffStatusSchema>;

export const RefusalReasonSchema = z.enum([
  'work_incomplete',
  'quality_issues',
  'not_as_described',
  'damage_caused',
  'other',
]);
export type RefusalReason = z.infer<typeof RefusalReasonSchema>;

export const SatisfactionLevelSchema = z.enum([
  'very_satisfied',
  'satisfied',
  'neutral',
  'dissatisfied',
  'very_dissatisfied',
]);
export type SatisfactionLevel = z.infer<typeof SatisfactionLevelSchema>;

// ============================================================================
// Signature Details Schema
// ============================================================================

export const SignatureDetailsSchema = z.object({
  signatureUrl: z.string().url(),
  signedAt: z.string().datetime(),
  signedByName: z.string(),
  signedByPhone: z.string().optional(),
  signedByEmail: z.string().email().optional(),
  ipAddress: z.string().optional(),
  deviceInfo: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});
export type SignatureDetails = z.infer<typeof SignatureDetailsSchema>;

// ============================================================================
// Dual Sign-Off Zod Schema
// ============================================================================

export const DualSignoffSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  workOrderId: z.string(),
  completionProofId: z.string(),
  
  // Status
  status: DualSignoffStatusSchema,
  
  // Technician Sign-Off
  technicianSignature: SignatureDetailsSchema.nullable(),
  technicianNotes: z.string().nullable(),
  
  // Customer Sign-Off
  customerSignature: SignatureDetailsSchema.nullable(),
  customerNotes: z.string().nullable(),
  customerId: z.string().nullable(),
  
  // Customer Response
  customerSatisfied: z.boolean().nullable(),
  satisfactionLevel: SatisfactionLevelSchema.nullable(),
  customerFeedback: z.string().nullable(),
  
  // Refusal
  customerRefused: z.boolean(),
  refusalReason: RefusalReasonSchema.nullable(),
  refusalDetails: z.string().nullable(),
  refusalPhotos: z.array(z.string()).default([]),
  
  // Completion
  isComplete: z.boolean(),
  completedAt: z.string().datetime().nullable(),
  
  // Follow-up
  followUpRequired: z.boolean(),
  followUpNotes: z.string().nullable(),
  followUpCreatedWorkOrderId: z.string().nullable(),
  
  // Expiration
  expiresAt: z.string().datetime().nullable(),
  
  // Metadata
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type DualSignoffData = z.infer<typeof DualSignoffSchema>;

// ============================================================================
// Dual Sign-Off Interface
// ============================================================================

export interface DualSignoff extends EntityMetadata {
  readonly id: DualSignoffId;
  readonly tenantId: TenantId;
  readonly workOrderId: WorkOrderId;
  readonly completionProofId: CompletionProofId;
  
  readonly status: DualSignoffStatus;
  
  // Technician Sign-Off
  readonly technicianSignature: SignatureDetails | null;
  readonly technicianNotes: string | null;
  
  // Customer Sign-Off
  readonly customerSignature: SignatureDetails | null;
  readonly customerNotes: string | null;
  readonly customerId: CustomerId | null;
  
  // Customer Response
  readonly customerSatisfied: boolean | null;
  readonly satisfactionLevel: SatisfactionLevel | null;
  readonly customerFeedback: string | null;
  
  // Refusal
  readonly customerRefused: boolean;
  readonly refusalReason: RefusalReason | null;
  readonly refusalDetails: string | null;
  readonly refusalPhotos: readonly string[];
  
  // Completion
  readonly isComplete: boolean;
  readonly completedAt: ISOTimestamp | null;
  
  // Follow-up
  readonly followUpRequired: boolean;
  readonly followUpNotes: string | null;
  readonly followUpCreatedWorkOrderId: WorkOrderId | null;
  
  // Expiration
  readonly expiresAt: ISOTimestamp | null;
  
  readonly metadata: Record<string, unknown>;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createDualSignoff(
  id: DualSignoffId,
  data: {
    tenantId: TenantId;
    workOrderId: WorkOrderId;
    completionProofId: CompletionProofId;
    customerId?: CustomerId;
    expiresAt?: Date;
  },
  createdBy: UserId
): DualSignoff {
  const now = new Date().toISOString();
  
  // Default expiration: 7 days from creation
  const defaultExpiry = new Date();
  defaultExpiry.setDate(defaultExpiry.getDate() + 7);

  return {
    id,
    tenantId: data.tenantId,
    workOrderId: data.workOrderId,
    completionProofId: data.completionProofId,
    
    status: 'pending_technician',
    
    technicianSignature: null,
    technicianNotes: null,
    
    customerSignature: null,
    customerNotes: null,
    customerId: data.customerId ?? null,
    
    customerSatisfied: null,
    satisfactionLevel: null,
    customerFeedback: null,
    
    customerRefused: false,
    refusalReason: null,
    refusalDetails: null,
    refusalPhotos: [],
    
    isComplete: false,
    completedAt: null,
    
    followUpRequired: false,
    followUpNotes: null,
    followUpCreatedWorkOrderId: null,
    
    expiresAt: data.expiresAt?.toISOString() ?? defaultExpiry.toISOString(),
    
    metadata: {},
    
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function addTechnicianSignature(
  signoff: DualSignoff,
  signature: SignatureDetails,
  notes: string | undefined,
  updatedBy: UserId
): DualSignoff {
  if (signoff.status !== 'pending_technician') {
    throw new Error('Can only add technician signature when pending_technician');
  }
  const now = new Date().toISOString();
  return {
    ...signoff,
    technicianSignature: signature,
    technicianNotes: notes ?? null,
    status: 'pending_customer',
    updatedAt: now,
    updatedBy,
  };
}

export function addCustomerSignature(
  signoff: DualSignoff,
  signature: SignatureDetails,
  data: {
    satisfied: boolean;
    satisfactionLevel?: SatisfactionLevel;
    feedback?: string;
    notes?: string;
  },
  updatedBy: UserId
): DualSignoff {
  if (signoff.status !== 'pending_customer') {
    throw new Error('Can only add customer signature when pending_customer');
  }
  const now = new Date().toISOString();
  return {
    ...signoff,
    customerSignature: signature,
    customerSatisfied: data.satisfied,
    satisfactionLevel: data.satisfactionLevel ?? null,
    customerFeedback: data.feedback ?? null,
    customerNotes: data.notes ?? null,
    status: 'completed',
    isComplete: true,
    completedAt: now,
    updatedAt: now,
    updatedBy,
  };
}

export function recordCustomerRefusal(
  signoff: DualSignoff,
  data: {
    reason: RefusalReason;
    details?: string;
    photos?: string[];
    followUpRequired?: boolean;
    followUpNotes?: string;
  },
  updatedBy: UserId
): DualSignoff {
  if (signoff.status !== 'pending_customer') {
    throw new Error('Can only record refusal when pending_customer');
  }
  const now = new Date().toISOString();
  return {
    ...signoff,
    customerRefused: true,
    refusalReason: data.reason,
    refusalDetails: data.details ?? null,
    refusalPhotos: data.photos ?? [],
    status: 'customer_refused',
    followUpRequired: data.followUpRequired ?? true,
    followUpNotes: data.followUpNotes ?? null,
    completedAt: now,
    updatedAt: now,
    updatedBy,
  };
}

export function markCustomerUnavailable(
  signoff: DualSignoff,
  notes: string | undefined,
  updatedBy: UserId
): DualSignoff {
  if (signoff.status !== 'pending_customer') {
    throw new Error('Can only mark unavailable when pending_customer');
  }
  const now = new Date().toISOString();
  return {
    ...signoff,
    status: 'customer_unavailable',
    customerNotes: notes ?? null,
    updatedAt: now,
    updatedBy,
  };
}

export function linkFollowUpWorkOrder(
  signoff: DualSignoff,
  workOrderId: WorkOrderId,
  updatedBy: UserId
): DualSignoff {
  if (!signoff.followUpRequired) {
    throw new Error('No follow-up is required for this signoff');
  }
  const now = new Date().toISOString();
  return {
    ...signoff,
    followUpCreatedWorkOrderId: workOrderId,
    updatedAt: now,
    updatedBy,
  };
}

export function isSignoffExpired(signoff: DualSignoff): boolean {
  if (!signoff.expiresAt) return false;
  return new Date(signoff.expiresAt) < new Date();
}

export function markExpired(signoff: DualSignoff, updatedBy: UserId): DualSignoff {
  if (signoff.isComplete) {
    throw new Error('Cannot expire a completed signoff');
  }
  const now = new Date().toISOString();
  return {
    ...signoff,
    status: 'expired',
    updatedAt: now,
    updatedBy,
  };
}

export function canAddCustomerSignature(signoff: DualSignoff): boolean {
  return signoff.status === 'pending_customer' && !isSignoffExpired(signoff);
}
