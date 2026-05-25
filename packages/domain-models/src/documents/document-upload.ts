/**
 * Document Upload domain model
 * Represents uploaded documents for KYC, evidence, and other purposes
 */

import { z } from 'zod';
import type {
  TenantId,
  UserId,
  CustomerId,
  EntityMetadata,
  ISOTimestamp,
  Brand,
} from '../common/types';
import {
  DocumentType,
  DocumentTypeSchema,
  DocumentStatus,
  DocumentStatusSchema,
  DocumentSource,
  DocumentSourceSchema,
} from '../common/enums';

// ============================================================================
// Type Aliases
// ============================================================================

export type DocumentUploadId = Brand<string, 'DocumentUploadId'>;
export type OcrExtractionId = Brand<string, 'OcrExtractionId'>;

export function asDocumentUploadId(id: string): DocumentUploadId {
  return id as DocumentUploadId;
}

// ============================================================================
// Nested Schemas
// ============================================================================

export const QualityAssessmentSchema = z.object({
  score: z.number().min(0).max(100),
  issues: z.array(z.object({
    type: z.enum(['blur', 'low_resolution', 'poor_lighting', 'partial_content', 'glare', 'obstructed', 'other']),
    severity: z.enum(['low', 'medium', 'high']),
    description: z.string(),
  })),
  assessedAt: z.string().datetime(),
  isAcceptable: z.boolean(),
});
export type QualityAssessment = z.infer<typeof QualityAssessmentSchema>;

export const DocumentMetadataSchema = z.object({
  pageCount: z.number().optional(),
  capturedAt: z.string().datetime().optional(),
  deviceInfo: z.string().optional(),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }).optional(),
  originalFileName: z.string().optional(),
  exifData: z.record(z.string(), z.unknown()).optional(),
});
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;

// ============================================================================
// Document Upload Zod Schema
// ============================================================================

export const DocumentUploadSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string().nullable(),
  
  // Classification
  documentType: DocumentTypeSchema,
  status: DocumentStatusSchema,
  source: DocumentSourceSchema,
  
  // File info
  fileUrl: z.string().url(),
  fileName: z.string(),
  fileSize: z.number(),
  mimeType: z.string(),
  checksum: z.string().nullable(),
  
  // Quality
  qualityAssessment: QualityAssessmentSchema.nullable(),
  
  // Entity association
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  
  // Metadata
  documentMetadata: DocumentMetadataSchema.nullable(),
  tags: z.array(z.string()).default([]),
  
  // OCR
  ocrExtractionId: z.string().nullable(),
  
  // Verification
  verificationStatus: z.enum(['pending', 'verified', 'rejected', 'expired']).default('pending'),
  verifiedAt: z.string().datetime().nullable(),
  verifiedBy: z.string().nullable(),
  verificationNotes: z.string().nullable(),
  
  // Rejection
  rejectedAt: z.string().datetime().nullable(),
  rejectedBy: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  
  // Expiry
  expiryDate: z.string().datetime().nullable(),
  expiryNotificationSent: z.boolean().default(false),
  
  // Versioning
  version: z.number().default(1),
  previousVersionId: z.string().nullable(),
  
  // Access control
  accessLevel: z.enum(['public', 'private', 'restricted']).default('private'),
  
  // Additional metadata
  additionalMetadata: z.record(z.string(), z.unknown()).default({}),
});

export type DocumentUploadData = z.infer<typeof DocumentUploadSchema>;

// ============================================================================
// Document Upload Interface
// ============================================================================

export interface DocumentUpload extends EntityMetadata {
  readonly id: DocumentUploadId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId | null;
  
  readonly documentType: DocumentType;
  readonly status: DocumentStatus;
  readonly source: DocumentSource;
  
  readonly fileUrl: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly mimeType: string;
  readonly checksum: string | null;
  
  readonly qualityAssessment: QualityAssessment | null;
  
  readonly entityType: string | null;
  readonly entityId: string | null;
  
  readonly documentMetadata: DocumentMetadata | null;
  readonly tags: readonly string[];
  
  readonly ocrExtractionId: OcrExtractionId | null;
  
  readonly verificationStatus: 'pending' | 'verified' | 'rejected' | 'expired';
  readonly verifiedAt: ISOTimestamp | null;
  readonly verifiedBy: UserId | null;
  readonly verificationNotes: string | null;
  
  readonly rejectedAt: ISOTimestamp | null;
  readonly rejectedBy: UserId | null;
  readonly rejectionReason: string | null;
  
  readonly expiryDate: ISOTimestamp | null;
  readonly expiryNotificationSent: boolean;
  
  readonly version: number;
  readonly previousVersionId: DocumentUploadId | null;
  
  readonly accessLevel: 'public' | 'private' | 'restricted';
  
  readonly additionalMetadata: Record<string, unknown>;
  
  // Soft delete
  readonly deletedAt: ISOTimestamp | null;
  readonly deletedBy: UserId | null;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createDocumentUpload(
  id: DocumentUploadId,
  data: {
    tenantId: TenantId;
    documentType: DocumentType;
    source: DocumentSource;
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    customerId?: CustomerId;
    checksum?: string;
    entityType?: string;
    entityId?: string;
    documentMetadata?: DocumentMetadata;
    tags?: string[];
    expiryDate?: Date;
    accessLevel?: 'public' | 'private' | 'restricted';
  },
  createdBy: UserId
): DocumentUpload {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    customerId: data.customerId ?? null,
    
    documentType: data.documentType,
    status: 'uploaded',
    source: data.source,
    
    fileUrl: data.fileUrl,
    fileName: data.fileName,
    fileSize: data.fileSize,
    mimeType: data.mimeType,
    checksum: data.checksum ?? null,
    
    qualityAssessment: null,
    
    entityType: data.entityType ?? null,
    entityId: data.entityId ?? null,
    
    documentMetadata: data.documentMetadata ?? null,
    tags: data.tags ?? [],
    
    ocrExtractionId: null,
    
    verificationStatus: 'pending',
    verifiedAt: null,
    verifiedBy: null,
    verificationNotes: null,
    
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    
    expiryDate: data.expiryDate?.toISOString() ?? null,
    expiryNotificationSent: false,
    
    version: 1,
    previousVersionId: null,
    
    accessLevel: data.accessLevel ?? 'private',
    
    additionalMetadata: {},
    
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

export function setQualityAssessment(
  doc: DocumentUpload,
  assessment: QualityAssessment,
  updatedBy: UserId
): DocumentUpload {
  const now = new Date().toISOString();
  const newStatus: DocumentStatus = assessment.isAcceptable ? doc.status : 'rejected';
  
  return {
    ...doc,
    qualityAssessment: assessment,
    status: newStatus,
    rejectionReason: assessment.isAcceptable ? doc.rejectionReason : 'Quality assessment failed',
    updatedAt: now,
    updatedBy,
  };
}

export function markProcessing(doc: DocumentUpload, updatedBy: UserId): DocumentUpload {
  const now = new Date().toISOString();
  return {
    ...doc,
    status: 'processing',
    updatedAt: now,
    updatedBy,
  };
}

export function linkOcrExtraction(
  doc: DocumentUpload,
  ocrExtractionId: OcrExtractionId,
  updatedBy: UserId
): DocumentUpload {
  const now = new Date().toISOString();
  return {
    ...doc,
    ocrExtractionId,
    status: 'ocr_complete',
    updatedAt: now,
    updatedBy,
  };
}

export function verifyDocument(
  doc: DocumentUpload,
  notes: string | undefined,
  verifiedBy: UserId
): DocumentUpload {
  const now = new Date().toISOString();
  return {
    ...doc,
    status: 'validated',
    verificationStatus: 'verified',
    verifiedAt: now,
    verifiedBy,
    verificationNotes: notes ?? null,
    updatedAt: now,
    updatedBy: verifiedBy,
  };
}

export function rejectDocument(
  doc: DocumentUpload,
  reason: string,
  rejectedBy: UserId
): DocumentUpload {
  const now = new Date().toISOString();
  return {
    ...doc,
    status: 'rejected',
    verificationStatus: 'rejected',
    rejectedAt: now,
    rejectedBy,
    rejectionReason: reason,
    updatedAt: now,
    updatedBy: rejectedBy,
  };
}

export function markExpired(doc: DocumentUpload, updatedBy: UserId): DocumentUpload {
  const now = new Date().toISOString();
  return {
    ...doc,
    status: 'expired',
    verificationStatus: 'expired',
    updatedAt: now,
    updatedBy,
  };
}

export function createNewVersion(
  previousDoc: DocumentUpload,
  newId: DocumentUploadId,
  data: {
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    checksum?: string;
  },
  createdBy: UserId
): DocumentUpload {
  const now = new Date().toISOString();
  return {
    ...previousDoc,
    id: newId,
    fileUrl: data.fileUrl,
    fileName: data.fileName,
    fileSize: data.fileSize,
    mimeType: data.mimeType,
    checksum: data.checksum ?? null,
    
    status: 'uploaded',
    verificationStatus: 'pending',
    verifiedAt: null,
    verifiedBy: null,
    verificationNotes: null,
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    
    qualityAssessment: null,
    ocrExtractionId: null,
    
    version: previousDoc.version + 1,
    previousVersionId: previousDoc.id,
    
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
    
    deletedAt: null,
    deletedBy: null,
  };
}

export function archiveDocument(doc: DocumentUpload, updatedBy: UserId): DocumentUpload {
  const now = new Date().toISOString();
  return {
    ...doc,
    status: 'archived',
    updatedAt: now,
    updatedBy,
  };
}

export function addTag(
  doc: DocumentUpload,
  tag: string,
  updatedBy: UserId
): DocumentUpload {
  if (doc.tags.includes(tag)) return doc;
  const now = new Date().toISOString();
  return {
    ...doc,
    tags: [...doc.tags, tag],
    updatedAt: now,
    updatedBy,
  };
}

export function isExpired(doc: DocumentUpload): boolean {
  if (!doc.expiryDate) return false;
  return new Date(doc.expiryDate) < new Date();
}

export function isVerified(doc: DocumentUpload): boolean {
  return doc.verificationStatus === 'verified';
}

export function isImage(doc: DocumentUpload): boolean {
  return doc.mimeType.startsWith('image/');
}

export function isPdf(doc: DocumentUpload): boolean {
  return doc.mimeType === 'application/pdf';
}

export function getFileExtension(doc: DocumentUpload): string {
  const parts = doc.fileName.split('.');
  if (parts.length < 2) return '';
  const last = parts[parts.length - 1];
  return last ? last.toLowerCase() : '';
}
