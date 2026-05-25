/**
 * Completion Proof domain model
 * Captures evidence of work completion for work orders
 */

import { z } from 'zod';
import type {
  TenantId,
  UserId,
  WorkOrderId,
  VendorId,
  CompletionProofId,
  DispatchEventId,
  EntityMetadata,
  ISOTimestamp,
} from '../common/types';
import { getDefaultCurrency } from '../common/region-config';

// ============================================================================
// Enums and Schemas
// ============================================================================

export const CompletionProofStatusSchema = z.enum([
  'pending_review',
  'approved',
  'rejected',
  'requires_more_info',
]);
export type CompletionProofStatus = z.infer<typeof CompletionProofStatusSchema>;

export const ProofTypeSchema = z.enum([
  'before_photo',
  'after_photo',
  'video',
  'document',
  'signature',
  'material_receipt',
  'warranty_document',
  'invoice',
  'other',
]);
export type ProofType = z.infer<typeof ProofTypeSchema>;

export const ProofItemSchema = z.object({
  id: z.string(),
  proofType: ProofTypeSchema,
  fileName: z.string(),
  fileType: z.string(),
  fileSize: z.number(),
  url: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  caption: z.string().optional(),
  uploadedAt: z.string().datetime(),
  uploadedBy: z.string(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ProofItem = z.infer<typeof ProofItemSchema>;

export const MaterialUsedSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  quantity: z.number(),
  unit: z.string(),
  unitCost: z.number().optional(),
  totalCost: z.number().optional(),
  // Currency resolves from tenant.defaultCurrency at the call site; USD is
  // a neutral last-resort fallback (see packages/config DEFAULT_FALLBACK_CURRENCY).
  currency: z.string().default('USD'),
  supplier: z.string().optional(),
  warrantyInfo: z.string().optional(),
});
export type MaterialUsed = z.infer<typeof MaterialUsedSchema>;

export const CompletionProofSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  workOrderId: z.string(),
  dispatchEventId: z.string().optional(),
  vendorId: z.string(),
  
  // Status
  status: CompletionProofStatusSchema,
  
  // Work summary
  workPerformed: z.string(),
  conditionBefore: z.string().optional(),
  conditionAfter: z.string(),
  additionalNotes: z.string().optional(),
  
  // Time
  workStartedAt: z.string().datetime(),
  workCompletedAt: z.string().datetime(),
  totalHours: z.number(),
  
  // Location verification
  completionLatitude: z.number().optional(),
  completionLongitude: z.number().optional(),
  locationVerified: z.boolean().default(false),
  
  // Proof items
  proofItems: z.array(ProofItemSchema).default([]),
  
  // Materials
  materialsUsed: z.array(MaterialUsedSchema).default([]),
  totalMaterialsCost: z.number().default(0),
  // Currency resolves from tenant.defaultCurrency at the call site; USD is
  // a neutral last-resort fallback (see packages/config DEFAULT_FALLBACK_CURRENCY).
  currency: z.string().default('USD'),
  
  // Technician
  technicianName: z.string(),
  technicianSignature: z.string().optional(),
  technicianSignedAt: z.string().datetime().optional(),
  
  // Issues/Recommendations
  issuesFound: z.string().optional(),
  recommendations: z.string().optional(),
  followUpRequired: z.boolean().default(false),
  followUpNotes: z.string().optional(),
  
  // Review
  reviewedAt: z.string().datetime().optional(),
  reviewedBy: z.string().optional(),
  reviewNotes: z.string().optional(),
  
  // Rejection
  rejectedAt: z.string().datetime().optional(),
  rejectedBy: z.string().optional(),
  rejectionReason: z.string().optional(),
  
  // Re-submission
  resubmissionCount: z.number().default(0),
  lastResubmittedAt: z.string().datetime().optional(),
  
  // Metadata
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type CompletionProofData = z.infer<typeof CompletionProofSchema>;

// ============================================================================
// Completion Proof Interface
// ============================================================================

export interface CompletionProof extends EntityMetadata {
  readonly id: CompletionProofId;
  readonly tenantId: TenantId;
  readonly workOrderId: WorkOrderId;
  readonly dispatchEventId: DispatchEventId | null;
  readonly vendorId: VendorId;
  
  readonly status: CompletionProofStatus;
  
  readonly workPerformed: string;
  readonly conditionBefore: string | null;
  readonly conditionAfter: string;
  readonly additionalNotes: string | null;
  
  readonly workStartedAt: ISOTimestamp;
  readonly workCompletedAt: ISOTimestamp;
  readonly totalHours: number;
  
  readonly completionLatitude: number | null;
  readonly completionLongitude: number | null;
  readonly locationVerified: boolean;
  
  readonly proofItems: readonly ProofItem[];
  
  readonly materialsUsed: readonly MaterialUsed[];
  readonly totalMaterialsCost: number;
  readonly currency: string;
  
  readonly technicianName: string;
  readonly technicianSignature: string | null;
  readonly technicianSignedAt: ISOTimestamp | null;
  
  readonly issuesFound: string | null;
  readonly recommendations: string | null;
  readonly followUpRequired: boolean;
  readonly followUpNotes: string | null;
  
  readonly reviewedAt: ISOTimestamp | null;
  readonly reviewedBy: UserId | null;
  readonly reviewNotes: string | null;
  
  readonly rejectedAt: ISOTimestamp | null;
  readonly rejectedBy: UserId | null;
  readonly rejectionReason: string | null;
  
  readonly resubmissionCount: number;
  readonly lastResubmittedAt: ISOTimestamp | null;
  
  readonly metadata: Record<string, unknown>;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createCompletionProof(
  id: CompletionProofId,
  data: {
    tenantId: TenantId;
    workOrderId: WorkOrderId;
    vendorId: VendorId;
    workPerformed: string;
    conditionAfter: string;
    workStartedAt: Date;
    workCompletedAt: Date;
    technicianName: string;
    dispatchEventId?: DispatchEventId;
    conditionBefore?: string;
    additionalNotes?: string;
    completionLatitude?: number;
    completionLongitude?: number;
    proofItems?: ProofItem[];
    materialsUsed?: MaterialUsed[];
    issuesFound?: string;
    recommendations?: string;
    followUpRequired?: boolean;
    followUpNotes?: string;
    /**
     * ISO 4217 currency for materials / totals. Callers should supply
     * `tenant.defaultCurrency` (resolve via `getDefaultCurrency(tenant.countryCode)`).
     * Falls back to the global `getDefaultCurrency(null)` (USD) only when unspecified.
     */
    currency?: string;
    /** ISO 3166-1 alpha-2 country code for tenant-aware currency fallback. */
    tenantCountryCode?: string;
  },
  createdBy: UserId
): CompletionProof {
  const now = new Date().toISOString();
  const startTime = data.workStartedAt.getTime();
  const endTime = data.workCompletedAt.getTime();
  const totalHours = (endTime - startTime) / (1000 * 60 * 60);
  
  const materialsUsed = data.materialsUsed ?? [];
  const totalMaterialsCost = materialsUsed.reduce((sum, m) => sum + (m.totalCost ?? 0), 0);

  return {
    id,
    tenantId: data.tenantId,
    workOrderId: data.workOrderId,
    dispatchEventId: data.dispatchEventId ?? null,
    vendorId: data.vendorId,
    
    status: 'pending_review',
    
    workPerformed: data.workPerformed,
    conditionBefore: data.conditionBefore ?? null,
    conditionAfter: data.conditionAfter,
    additionalNotes: data.additionalNotes ?? null,
    
    workStartedAt: data.workStartedAt.toISOString(),
    workCompletedAt: data.workCompletedAt.toISOString(),
    totalHours: Math.round(totalHours * 100) / 100,
    
    completionLatitude: data.completionLatitude ?? null,
    completionLongitude: data.completionLongitude ?? null,
    locationVerified: !!(data.completionLatitude && data.completionLongitude),
    
    proofItems: data.proofItems ?? [],
    
    materialsUsed,
    totalMaterialsCost,
    currency: data.currency ?? getDefaultCurrency(data.tenantCountryCode ?? null),
    
    technicianName: data.technicianName,
    technicianSignature: null,
    technicianSignedAt: null,
    
    issuesFound: data.issuesFound ?? null,
    recommendations: data.recommendations ?? null,
    followUpRequired: data.followUpRequired ?? false,
    followUpNotes: data.followUpNotes ?? null,
    
    reviewedAt: null,
    reviewedBy: null,
    reviewNotes: null,
    
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    
    resubmissionCount: 0,
    lastResubmittedAt: null,
    
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

export function addProofItem(
  proof: CompletionProof,
  item: ProofItem,
  updatedBy: UserId
): CompletionProof {
  return {
    ...proof,
    proofItems: [...proof.proofItems, item],
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function addMaterial(
  proof: CompletionProof,
  material: MaterialUsed,
  updatedBy: UserId
): CompletionProof {
  const newMaterials = [...proof.materialsUsed, material];
  const totalCost = newMaterials.reduce((sum, m) => sum + (m.totalCost ?? 0), 0);
  
  return {
    ...proof,
    materialsUsed: newMaterials,
    totalMaterialsCost: totalCost,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function addTechnicianSignature(
  proof: CompletionProof,
  signatureUrl: string,
  updatedBy: UserId
): CompletionProof {
  const now = new Date().toISOString();
  return {
    ...proof,
    technicianSignature: signatureUrl,
    technicianSignedAt: now,
    updatedAt: now,
    updatedBy,
  };
}

export function approveProof(
  proof: CompletionProof,
  reviewNotes: string | undefined,
  reviewedBy: UserId
): CompletionProof {
  if (proof.status !== 'pending_review' && proof.status !== 'requires_more_info') {
    throw new Error('Can only approve pending or info-required proofs');
  }
  const now = new Date().toISOString();
  return {
    ...proof,
    status: 'approved',
    reviewedAt: now,
    reviewedBy,
    reviewNotes: reviewNotes ?? null,
    updatedAt: now,
    updatedBy: reviewedBy,
  };
}

export function rejectProof(
  proof: CompletionProof,
  reason: string,
  rejectedBy: UserId
): CompletionProof {
  if (proof.status !== 'pending_review' && proof.status !== 'requires_more_info') {
    throw new Error('Can only reject pending or info-required proofs');
  }
  const now = new Date().toISOString();
  return {
    ...proof,
    status: 'rejected',
    rejectedAt: now,
    rejectedBy,
    rejectionReason: reason,
    updatedAt: now,
    updatedBy: rejectedBy,
  };
}

export function requestMoreInfo(
  proof: CompletionProof,
  reviewNotes: string,
  reviewedBy: UserId
): CompletionProof {
  if (proof.status !== 'pending_review') {
    throw new Error('Can only request more info for pending proofs');
  }
  const now = new Date().toISOString();
  return {
    ...proof,
    status: 'requires_more_info',
    reviewedAt: now,
    reviewedBy,
    reviewNotes,
    updatedAt: now,
    updatedBy: reviewedBy,
  };
}

export function resubmitProof(
  proof: CompletionProof,
  updatedBy: UserId
): CompletionProof {
  if (proof.status !== 'rejected' && proof.status !== 'requires_more_info') {
    throw new Error('Can only resubmit rejected or info-required proofs');
  }
  const now = new Date().toISOString();
  return {
    ...proof,
    status: 'pending_review',
    resubmissionCount: proof.resubmissionCount + 1,
    lastResubmittedAt: now,
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    updatedAt: now,
    updatedBy,
  };
}
