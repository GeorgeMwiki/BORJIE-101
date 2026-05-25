/**
 * Evidence Attachment domain model
 * Represents evidence documents attached to cases
 */

import { z } from 'zod';
import type {
  TenantId,
  UserId,
  EntityMetadata,
  ISOTimestamp,
  Brand,
} from '../common/types';
import {
  EvidenceType,
  EvidenceTypeSchema,
} from '../common/enums';

// ============================================================================
// Type Aliases
// ============================================================================

export type EvidenceAttachmentId = Brand<string, 'EvidenceAttachmentId'>;
export type CaseId = Brand<string, 'CaseId'>;
export type DocumentUploadId = Brand<string, 'DocumentUploadId'>;

export function asEvidenceAttachmentId(id: string): EvidenceAttachmentId {
  return id as EvidenceAttachmentId;
}

// ============================================================================
// Evidence Attachment Zod Schema
// ============================================================================

export const EvidenceVerificationSchema = z.object({
  isVerified: z.boolean(),
  verifiedAt: z.string().datetime().nullable(),
  verifiedBy: z.string().nullable(),
  verificationMethod: z.string().nullable(),
  verificationNotes: z.string().nullable(),
  integrityHash: z.string().nullable(),
});
export type EvidenceVerification = z.infer<typeof EvidenceVerificationSchema>;

export const EvidenceMetadataSchema = z.object({
  capturedAt: z.string().datetime().nullable(),
  capturedBy: z.string().nullable(),
  deviceInfo: z.string().nullable(),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracy: z.number().optional(),
    address: z.string().optional(),
  }).nullable(),
  exifData: z.record(z.string(), z.unknown()).nullable(),
});
export type EvidenceMetadata = z.infer<typeof EvidenceMetadataSchema>;

export const EvidenceAttachmentSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  caseId: z.string(),
  
  // Classification
  evidenceType: EvidenceTypeSchema,
  
  // Description
  title: z.string(),
  description: z.string().nullable(),
  
  // File info
  fileUrl: z.string().url(),
  fileName: z.string(),
  fileSize: z.number(),
  mimeType: z.string(),
  
  // Linked document
  documentUploadId: z.string().nullable(),
  
  // Integrity
  checksum: z.string().nullable(),
  
  // Metadata
  evidenceMetadata: EvidenceMetadataSchema.nullable(),
  
  // Verification
  verification: EvidenceVerificationSchema,
  
  // Relevance
  relevanceNotes: z.string().nullable(),
  
  // Chain of custody
  uploadedAt: z.string().datetime(),
  uploadedBy: z.string(),
  lastAccessedAt: z.string().datetime().nullable(),
  accessCount: z.number().default(0),
});

export type EvidenceAttachmentData = z.infer<typeof EvidenceAttachmentSchema>;

// ============================================================================
// Evidence Attachment Interface
// ============================================================================

export interface EvidenceAttachment extends EntityMetadata {
  readonly id: EvidenceAttachmentId;
  readonly tenantId: TenantId;
  readonly caseId: CaseId;
  
  readonly evidenceType: EvidenceType;
  
  readonly title: string;
  readonly description: string | null;
  
  readonly fileUrl: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly mimeType: string;
  
  readonly documentUploadId: DocumentUploadId | null;
  
  readonly checksum: string | null;
  
  readonly evidenceMetadata: EvidenceMetadata | null;
  
  readonly verification: EvidenceVerification;
  
  readonly relevanceNotes: string | null;
  
  readonly uploadedAt: ISOTimestamp;
  readonly uploadedBy: UserId;
  readonly lastAccessedAt: ISOTimestamp | null;
  readonly accessCount: number;
  
  // Soft delete
  readonly deletedAt: ISOTimestamp | null;
  readonly deletedBy: UserId | null;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createEvidenceAttachment(
  id: EvidenceAttachmentId,
  data: {
    tenantId: TenantId;
    caseId: CaseId;
    evidenceType: EvidenceType;
    title: string;
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    description?: string;
    documentUploadId?: DocumentUploadId;
    checksum?: string;
    evidenceMetadata?: EvidenceMetadata;
    relevanceNotes?: string;
  },
  uploadedBy: UserId
): EvidenceAttachment {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    caseId: data.caseId,
    
    evidenceType: data.evidenceType,
    
    title: data.title,
    description: data.description ?? null,
    
    fileUrl: data.fileUrl,
    fileName: data.fileName,
    fileSize: data.fileSize,
    mimeType: data.mimeType,
    
    documentUploadId: data.documentUploadId ?? null,
    
    checksum: data.checksum ?? null,
    
    evidenceMetadata: data.evidenceMetadata ?? null,
    
    verification: {
      isVerified: false,
      verifiedAt: null,
      verifiedBy: null,
      verificationMethod: null,
      verificationNotes: null,
      integrityHash: data.checksum ?? null,
    },
    
    relevanceNotes: data.relevanceNotes ?? null,
    
    uploadedAt: now,
    uploadedBy,
    lastAccessedAt: null,
    accessCount: 0,
    
    createdAt: now,
    updatedAt: now,
    createdBy: uploadedBy,
    updatedBy: uploadedBy,
    
    deletedAt: null,
    deletedBy: null,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function verifyEvidence(
  evidence: EvidenceAttachment,
  data: {
    method: string;
    notes?: string;
    integrityHash?: string;
  },
  verifiedBy: UserId
): EvidenceAttachment {
  const now = new Date().toISOString();
  return {
    ...evidence,
    verification: {
      isVerified: true,
      verifiedAt: now,
      verifiedBy,
      verificationMethod: data.method,
      verificationNotes: data.notes ?? null,
      integrityHash: data.integrityHash ?? evidence.verification.integrityHash,
    },
    updatedAt: now,
    updatedBy: verifiedBy,
  };
}

export function recordAccess(
  evidence: EvidenceAttachment,
  accessedBy: UserId
): EvidenceAttachment {
  const now = new Date().toISOString();
  return {
    ...evidence,
    lastAccessedAt: now,
    accessCount: evidence.accessCount + 1,
    updatedAt: now,
    updatedBy: accessedBy,
  };
}

export function addRelevanceNotes(
  evidence: EvidenceAttachment,
  notes: string,
  updatedBy: UserId
): EvidenceAttachment {
  const now = new Date().toISOString();
  return {
    ...evidence,
    relevanceNotes: notes,
    updatedAt: now,
    updatedBy,
  };
}

export function softDeleteEvidence(
  evidence: EvidenceAttachment,
  deletedBy: UserId
): EvidenceAttachment {
  const now = new Date().toISOString();
  return {
    ...evidence,
    deletedAt: now,
    deletedBy,
    updatedAt: now,
    updatedBy: deletedBy,
  };
}

export function isVerified(evidence: EvidenceAttachment): boolean {
  return evidence.verification.isVerified;
}

export function getFileExtension(evidence: EvidenceAttachment): string {
  const parts = evidence.fileName.split('.');
  if (parts.length < 2) return '';
  const last = parts[parts.length - 1];
  return last ? last.toLowerCase() : '';
}

export function isImageEvidence(evidence: EvidenceAttachment): boolean {
  return evidence.mimeType.startsWith('image/');
}

export function isVideoEvidence(evidence: EvidenceAttachment): boolean {
  return evidence.mimeType.startsWith('video/');
}

export function isAudioEvidence(evidence: EvidenceAttachment): boolean {
  return evidence.mimeType.startsWith('audio/');
}
