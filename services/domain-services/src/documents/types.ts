/**
 * Document Management Types
 * Multi-tenant document isolation with versioning and access control.
 */

import type { TenantId, UserId, ISOTimestamp } from '@borjie/domain-models';

/** Branded ID for documents */
export type DocumentId = string & { __brand: 'DocumentId' };
export function asDocumentId(id: string): DocumentId {
  return id as DocumentId;
}

/** Document categories for property management */
export const DOCUMENT_CATEGORIES = [
  'lease',
  'id_document',
  'inspection_report',
  'invoice',
  'receipt',
  'maintenance',
  'legal',
  'other',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/** Access levels for document access */
export const DOCUMENT_ACCESS_LEVELS = ['view', 'download', 'edit', 'share', 'delete'] as const;
export type DocumentAccessLevel = (typeof DOCUMENT_ACCESS_LEVELS)[number];

/** Permission levels for document access (alias for backward compatibility) */
export const DOCUMENT_PERMISSIONS = DOCUMENT_ACCESS_LEVELS;
export type DocumentPermission = DocumentAccessLevel;

/** Entity types documents can be linked to */
export const DOCUMENT_ENTITY_TYPES = ['lease', 'customer', 'property', 'unit', 'work_order'] as const;
export type DocumentEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number];

/** Document metadata - extensible key-value */
export type DocumentMetadata = Record<string, unknown>;

/** Document entity - tenant-scoped */
export interface Document {
  readonly id: DocumentId;
  readonly tenantId: TenantId;
  readonly category: DocumentCategory;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly storageKey: string;
  readonly url: string;
  readonly metadata: DocumentMetadata;
  readonly uploadedBy: UserId;
  readonly createdAt: ISOTimestamp;
  readonly propertyId?: string;
  readonly customerId?: string;
  readonly leaseId?: string;
  readonly entityType?: DocumentEntityType;
  readonly entityId?: string;
}

/** Document access record */
export interface DocumentAccess {
  readonly documentId: DocumentId;
  readonly userId: UserId;
  readonly accessLevel: DocumentAccessLevel;
  readonly grantedAt: ISOTimestamp;
  readonly id?: string;
  readonly tenantId?: TenantId; // Populated when granting, for repository isolation
}

/** Filters for document listing */
export interface DocumentFilters {
  readonly category?: DocumentCategory;
  readonly propertyId?: string;
  readonly customerId?: string;
  readonly leaseId?: string;
  readonly entityType?: DocumentEntityType;
  readonly entityId?: string;
  readonly tags?: readonly string[];
  readonly searchQuery?: string;
  readonly createdAfter?: ISOTimestamp;
  readonly createdBefore?: ISOTimestamp;
}

/** Upload input */
export interface UploadDocumentInput {
  readonly category: DocumentCategory;
  readonly metadata?: DocumentMetadata;
  readonly entityType?: DocumentEntityType;
  readonly entityId?: string;
  readonly propertyId?: string;
  readonly customerId?: string;
  readonly leaseId?: string;
}

/** File content for upload */
export interface UploadedFile {
  readonly buffer: Buffer | Blob;
  readonly originalName: string;
  readonly mimeType: string;
  readonly size: number;
}

/** Document version for version tracking (optional) */
export interface DocumentVersion {
  readonly id: string;
  readonly documentId: DocumentId;
  readonly tenantId: TenantId;
  readonly version: number;
  readonly storageKey: string;
  readonly metadata: DocumentMetadata;
  readonly createdAt: ISOTimestamp;
  readonly createdBy: UserId;
}

// ============================================================================
// OCR Extraction Types
// ============================================================================

/** OCR extraction status */
export type OCRExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** Result of OCR text extraction */
export interface OCRExtractionResult {
  readonly documentId: DocumentId;
  readonly tenantId: TenantId;
  readonly status: OCRExtractionStatus;
  readonly extractedText: string | null;
  readonly structuredData: Record<string, unknown> | null;
  readonly confidence: number; // 0-1 confidence score
  readonly language: string | null;
  readonly pageCount: number;
  readonly extractedAt: ISOTimestamp | null;
  readonly error: string | null;
}

/** Interface for external OCR provider */
export interface OCRProvider {
  extractText(
    fileBuffer: Buffer,
    mimeType: string,
    options?: { language?: string; structuredExtraction?: boolean }
  ): Promise<{
    text: string;
    structuredData: Record<string, unknown> | null;
    confidence: number;
    language: string;
    pageCount: number;
  }>;
}

// ============================================================================
// Document Validation & Fraud Detection Types
// ============================================================================

export type FraudFlagSeverity = 'low' | 'medium' | 'high' | 'critical';
export type FraudFlagType =
  | 'metadata_tampering'
  | 'image_manipulation'
  | 'date_inconsistency'
  | 'duplicate_document'
  | 'expired_document'
  | 'suspicious_format'
  | 'missing_watermark'
  | 'other';

export interface DocumentFraudFlag {
  readonly type: FraudFlagType;
  readonly severity: FraudFlagSeverity;
  readonly description: string;
  readonly details: Record<string, unknown>;
  readonly detectedAt: ISOTimestamp;
}

export type DocumentValidationStatus = 'pending' | 'valid' | 'invalid' | 'flagged' | 'requires_review';

export interface DocumentValidationResult {
  readonly documentId: DocumentId;
  readonly tenantId: TenantId;
  readonly status: DocumentValidationStatus;
  readonly isValid: boolean;
  readonly fraudFlags: readonly DocumentFraudFlag[];
  readonly validatedAt: ISOTimestamp;
  readonly validatedBy: UserId | null; // null if auto-validated
  readonly expiresAt: ISOTimestamp | null; // for ID documents etc.
  readonly notes: string | null;
}

// ============================================================================
// Evidence Pack Types
// ============================================================================

export interface EvidencePackItem {
  readonly documentId: DocumentId;
  readonly documentName: string;
  readonly category: DocumentCategory;
  readonly description: string;
  readonly addedAt: ISOTimestamp;
  readonly addedBy: UserId;
  readonly sortOrder: number;
}

export interface EvidencePack {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly title: string;
  readonly description: string | null;
  readonly caseId: string | null; // linked compliance case
  readonly leaseId: string | null; // linked lease
  readonly items: readonly EvidencePackItem[];
  readonly compiledBy: UserId;
  readonly compiledAt: ISOTimestamp;
  readonly status: 'draft' | 'compiled' | 'submitted' | 'archived';
}
