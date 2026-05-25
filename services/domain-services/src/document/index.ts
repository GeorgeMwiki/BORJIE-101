import { randomHex } from '../common/id-generator.js';
/**
 * Document domain service.
 * Handles document upload, verification, OCR extraction, evidence pack compilation,
 * and version tracking for the BORJIE platform.
 */

import type {
  TenantId,
  UserId,
  PaginationParams,
  PaginatedResult,
  Result,
  ISOTimestamp,
} from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';

// ============================================================================
// Types
// ============================================================================

export type DocumentId = string & { readonly __brand: 'DocumentId' };
export const asDocumentId = (id: string): DocumentId => id as DocumentId;

export type DocumentCategory = 
  | 'id_document' | 'lease_agreement' | 'payment_receipt'
  | 'maintenance_photo' | 'inspection_report' | 'utility_bill'
  | 'insurance' | 'legal' | 'correspondence' | 'other';

export type DocumentEntityType = 'customer' | 'lease' | 'property' | 'unit' | 'work_order' | 'case';

export type DocumentAccessLevel = 'view' | 'download' | 'edit' | 'admin';

export type DocumentValidationStatus = 'valid' | 'invalid' | 'flagged' | 'requires_review' | 'pending';

export type FraudFlagSeverity = 'low' | 'medium' | 'high' | 'critical';

export type FraudFlagType = 'suspicious_format' | 'expired_document' | 'date_inconsistency' | 'duplicate' | 'tampered';

export type OCRExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Document {
  readonly id: DocumentId;
  readonly tenantId: TenantId;
  readonly category: DocumentCategory;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly storageKey: string;
  readonly url: string;
  readonly metadata: Record<string, unknown>;
  readonly uploadedBy: UserId;
  readonly createdAt: ISOTimestamp;
  readonly entityType?: DocumentEntityType;
  readonly entityId?: string;
}

export interface DocumentVersion {
  readonly id: string;
  readonly documentId: DocumentId;
  readonly tenantId: TenantId;
  readonly version: number;
  readonly storageKey: string;
  readonly url: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: ISOTimestamp;
  readonly createdBy: UserId;
}

export interface DocumentFraudFlag {
  readonly type: FraudFlagType;
  readonly severity: FraudFlagSeverity;
  readonly description: string;
  readonly details: Record<string, unknown>;
  readonly detectedAt: ISOTimestamp;
}

export interface DocumentValidationResult {
  readonly documentId: DocumentId;
  readonly tenantId: TenantId;
  readonly status: DocumentValidationStatus;
  readonly isValid: boolean;
  readonly fraudFlags: readonly DocumentFraudFlag[];
  readonly validatedAt: ISOTimestamp;
  readonly validatedBy: UserId | null;
  readonly expiresAt: string | null;
  readonly notes: string | null;
}

export interface OCRExtractionResult {
  readonly documentId: DocumentId;
  readonly tenantId: TenantId;
  readonly status: OCRExtractionStatus;
  readonly extractedText: string | null;
  readonly structuredData: Record<string, unknown> | null;
  readonly confidence: number;
  readonly language: string | null;
  readonly pageCount: number;
  readonly extractedAt: ISOTimestamp | null;
  readonly error: string | null;
}

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
  readonly caseId: string | null;
  readonly leaseId: string | null;
  readonly items: readonly EvidencePackItem[];
  readonly compiledBy: UserId;
  readonly compiledAt: ISOTimestamp;
  readonly status: 'compiled' | 'finalized' | 'submitted';
}

// ============================================================================
// Error Types
// ============================================================================

export const DocumentServiceError = {
  DOCUMENT_NOT_FOUND: 'DOCUMENT_NOT_FOUND',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  DELETE_FAILED: 'DELETE_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  EVIDENCE_PACK_EMPTY: 'EVIDENCE_PACK_EMPTY',
  OCR_NOT_CONFIGURED: 'OCR_NOT_CONFIGURED',
  OCR_UNSUPPORTED_TYPE: 'OCR_UNSUPPORTED_TYPE',
  VERSION_NOT_SUPPORTED: 'VERSION_NOT_SUPPORTED',
} as const;

export type DocumentServiceErrorCode = (typeof DocumentServiceError)[keyof typeof DocumentServiceError];

export interface DocumentServiceErrorResult {
  code: DocumentServiceErrorCode;
  message: string;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface DocumentRepository {
  findById(id: DocumentId, tenantId: TenantId): Promise<Document | null>;
  findMany(tenantId: TenantId, filters: DocumentFilters, pagination?: PaginationParams): Promise<PaginatedResult<Document>>;
  findByEntity(entityType: DocumentEntityType, entityId: string, tenantId: TenantId): Promise<readonly Document[]>;
  findByIds(ids: readonly DocumentId[], tenantId: TenantId): Promise<readonly Document[]>;
  create(document: Document): Promise<Document>;
  update(document: Document): Promise<Document>;
  delete(id: DocumentId, tenantId: TenantId): Promise<void>;
  // Version tracking (optional - not all repos support it)
  createVersion?(version: DocumentVersion): Promise<DocumentVersion>;
  findVersions?(documentId: DocumentId, tenantId: TenantId): Promise<readonly DocumentVersion[]>;
  getLatestVersion?(documentId: DocumentId, tenantId: TenantId): Promise<DocumentVersion | null>;
}

export interface StorageProvider {
  upload(params: { tenantId: TenantId; key: string; content: Buffer; contentType: string; metadata?: Record<string, unknown> }): Promise<{ key: string; url: string }>;
  download(tenantId: TenantId, key: string): Promise<Buffer>;
  delete(tenantId: TenantId, key: string): Promise<void>;
  getSignedUrl(tenantId: TenantId, key: string, options: { expiresIn: number }): Promise<string>;
}

/**
 * Interface for external OCR provider.
 * Implement this to integrate with Google Vision, AWS Textract, Azure Form Recognizer, etc.
 */
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

export interface DocumentFilters {
  category?: DocumentCategory;
  entityType?: DocumentEntityType;
  entityId?: string;
  uploadedBy?: UserId;
  fromDate?: ISOTimestamp;
  toDate?: ISOTimestamp;
}

// ============================================================================
// Input Types
// ============================================================================

export interface UploadDocumentInput {
  file: { originalName: string; mimeType: string; size: number; buffer: Buffer };
  category: DocumentCategory;
  metadata?: Record<string, unknown>;
  entityType?: DocumentEntityType;
  entityId?: string;
}

export interface VerifyDocumentInput {
  documentType?: string;
  expectedFields?: Record<string, unknown>;
  checkExpiry?: boolean;
  checkFormat?: boolean;
}

// ============================================================================
// Domain Events
// ============================================================================

export interface DocumentUploadedEvent {
  eventId: string;
  eventType: 'DocumentUploaded';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    documentId: DocumentId;
    category: DocumentCategory;
    name: string;
    size: number;
  };
}

export interface DocumentOCRCompletedEvent {
  eventId: string;
  eventType: 'DocumentOCRCompleted';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    documentId: DocumentId;
    confidence: number;
    pageCount: number;
    hasStructuredData: boolean;
  };
}

export interface DocumentFraudFlaggedEvent {
  eventId: string;
  eventType: 'DocumentFraudFlagged';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    documentId: DocumentId;
    flagCount: number;
    highestSeverity: string;
    flagTypes: readonly string[];
  };
}

export interface EvidencePackCompiledEvent {
  eventId: string;
  eventType: 'EvidencePackCompiled';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    packId: string;
    title: string;
    documentCount: number;
    caseId: string | null;
  };
}

// ============================================================================
// Document Service Implementation
// ============================================================================

/**
 * Document management service.
 * Handles upload, retrieval, OCR extraction, validation/fraud detection,
 * evidence pack compilation, and version tracking.
 */
export class DocumentService {
  private readonly ocrProvider: OCRProvider | null;

  constructor(
    private readonly documentRepo: DocumentRepository,
    private readonly storage: StorageProvider,
    private readonly eventBus: EventBus,
    ocrProvider?: OCRProvider
  ) {
    this.ocrProvider = ocrProvider ?? null;
  }

  // ==================== Upload & Retrieval ====================

  /** Upload a document */
  async upload(
    tenantId: TenantId,
    input: UploadDocumentInput,
    uploadedBy: UserId,
    correlationId: string
  ): Promise<Result<Document, DocumentServiceErrorResult>> {
    const now = new Date().toISOString();
    const docId = asDocumentId(`doc_${Date.now()}_${randomHex(4)}`);
    const storageKey = `${input.category}/${docId}/${input.file.originalName}`;

    try {
      const uploadResult = await this.storage.upload({
        tenantId, key: storageKey,
        content: input.file.buffer, contentType: input.file.mimeType,
        metadata: { originalName: input.file.originalName, documentId: docId, category: input.category },
      });

      const document: Document = {
        id: docId, tenantId, category: input.category,
        name: input.file.originalName, mimeType: input.file.mimeType, size: input.file.size,
        storageKey: uploadResult.key, url: uploadResult.url,
        metadata: { ...(input.metadata ?? {}), currentVersion: 1 },
        uploadedBy, createdAt: now,
        entityType: input.entityType, entityId: input.entityId,
      };

      const saved = await this.documentRepo.create(document);

      // Create initial version (v1) if repo supports versioning
      if (this.documentRepo.createVersion) {
        await this.documentRepo.createVersion({
          id: `ver_${docId}_1`,
          documentId: docId,
          tenantId,
          version: 1,
          storageKey: uploadResult.key,
          url: uploadResult.url,
          name: input.file.originalName,
          mimeType: input.file.mimeType,
          size: input.file.size,
          metadata: input.metadata ?? {},
          createdAt: now,
          createdBy: uploadedBy,
        });
      }

      const event: DocumentUploadedEvent = {
        eventId: generateEventId(), eventType: 'DocumentUploaded',
        timestamp: now, tenantId, correlationId, causationId: null, metadata: {},
        payload: { documentId: docId, category: input.category, name: input.file.originalName, size: input.file.size },
      };
      await this.eventBus.publish(createEventEnvelope(event, docId, 'Document'));
      return ok(saved);
    } catch (e) {
      return err({ code: DocumentServiceError.UPLOAD_FAILED, message: e instanceof Error ? e.message : 'Upload failed' });
    }
  }

  /** Get document by ID */
  async getDocument(documentId: DocumentId, tenantId: TenantId): Promise<Result<Document, DocumentServiceErrorResult>> {
    const doc = await this.documentRepo.findById(documentId, tenantId);
    if (!doc) return err({ code: DocumentServiceError.DOCUMENT_NOT_FOUND, message: 'Document not found' });
    return ok(doc);
  }

  /** List documents */
  async listDocuments(
    tenantId: TenantId, filters: DocumentFilters, pagination?: PaginationParams
  ): Promise<PaginatedResult<Document>> {
    return this.documentRepo.findMany(tenantId, filters, pagination ?? { limit: 50, offset: 0 });
  }

  /** Get documents by entity */
  async getDocumentsByEntity(
    entityType: DocumentEntityType, entityId: string, tenantId: TenantId
  ): Promise<readonly Document[]> {
    return this.documentRepo.findByEntity(entityType, entityId, tenantId);
  }

  /** Delete a document */
  async deleteDocument(
    documentId: DocumentId, tenantId: TenantId, deletedBy: UserId, correlationId: string
  ): Promise<Result<void, DocumentServiceErrorResult>> {
    const doc = await this.documentRepo.findById(documentId, tenantId);
    if (!doc) return err({ code: DocumentServiceError.DOCUMENT_NOT_FOUND, message: 'Document not found' });

    try {
      await this.storage.delete(tenantId, doc.storageKey);
      await this.documentRepo.delete(documentId, tenantId);
      return ok(undefined);
    } catch (e) {
      return err({ code: DocumentServiceError.DELETE_FAILED, message: e instanceof Error ? e.message : 'Delete failed' });
    }
  }

  // ==================== OCR Extraction ====================

  /** Supported MIME types for OCR extraction */
  private static readonly OCR_EXTRACTABLE_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/tiff',
    'image/webp',
  ];

  /**
   * Request OCR text extraction for a document.
   * Interfaces with an external OCR provider (Google Vision, AWS Textract, etc.)
   * to extract text and optionally structured data from PDFs and images.
   */
  async extractText(
    documentId: DocumentId,
    tenantId: TenantId,
    options?: { language?: string; structuredExtraction?: boolean },
    correlationId = ''
  ): Promise<Result<OCRExtractionResult, DocumentServiceErrorResult>> {
    if (!this.ocrProvider) {
      return err({
        code: DocumentServiceError.OCR_NOT_CONFIGURED,
        message: 'OCR provider not configured. Supply an OCRProvider implementation at construction time.',
      });
    }

    const doc = await this.documentRepo.findById(documentId, tenantId);
    if (!doc) {
      return err({ code: DocumentServiceError.DOCUMENT_NOT_FOUND, message: 'Document not found' });
    }

    // Validate MIME type is extractable
    if (!DocumentService.OCR_EXTRACTABLE_TYPES.includes(doc.mimeType)) {
      return err({
        code: DocumentServiceError.OCR_UNSUPPORTED_TYPE,
        message: `Cannot extract text from ${doc.mimeType}. Supported: ${DocumentService.OCR_EXTRACTABLE_TYPES.join(', ')}`,
      });
    }

    try {
      // Download file content from storage
      const content = await this.storage.download(tenantId, doc.storageKey);

      // Call external OCR provider
      const ocrResult = await this.ocrProvider.extractText(content, doc.mimeType, options);

      const now = new Date().toISOString();
      const extractionResult: OCRExtractionResult = {
        documentId,
        tenantId,
        status: 'completed',
        extractedText: ocrResult.text,
        structuredData: ocrResult.structuredData,
        confidence: ocrResult.confidence,
        language: ocrResult.language,
        pageCount: ocrResult.pageCount,
        extractedAt: now,
        error: null,
      };

      // Update document metadata with OCR results
      const updatedDoc: Document = {
        ...doc,
        metadata: {
          ...doc.metadata,
          ocrExtracted: true,
          ocrConfidence: ocrResult.confidence,
          ocrLanguage: ocrResult.language,
          ocrPageCount: ocrResult.pageCount,
          ocrExtractedAt: now,
        },
      };
      await this.documentRepo.update(updatedDoc);

      // Publish OCR completed event
      const event: DocumentOCRCompletedEvent = {
        eventId: generateEventId(),
        eventType: 'DocumentOCRCompleted',
        timestamp: now,
        tenantId,
        correlationId,
        causationId: null,
        metadata: {},
        payload: {
          documentId,
          confidence: ocrResult.confidence,
          pageCount: ocrResult.pageCount,
          hasStructuredData: ocrResult.structuredData !== null,
        },
      };
      await this.eventBus.publish(createEventEnvelope(event, documentId, 'Document'));

      return ok(extractionResult);
    } catch (e) {
      // Return a failed result rather than throwing - caller can inspect status
      const failedResult: OCRExtractionResult = {
        documentId,
        tenantId,
        status: 'failed',
        extractedText: null,
        structuredData: null,
        confidence: 0,
        language: null,
        pageCount: 0,
        extractedAt: null,
        error: e instanceof Error ? e.message : 'OCR extraction failed',
      };
      return ok(failedResult);
    }
  }

  // ==================== Document Validation & Fraud Detection ====================

  /**
   * Validate a document and check for potential fraud indicators.
   * Performs automated checks on file size, MIME type consistency,
   * expiry dates, date consistency, and size anomalies.
   */
  async verify(
    documentId: DocumentId, tenantId: TenantId, input: VerifyDocumentInput,
    verifiedBy: UserId, correlationId: string
  ): Promise<Result<DocumentValidationResult, DocumentServiceErrorResult>> {
    const doc = await this.documentRepo.findById(documentId, tenantId);
    if (!doc) return err({ code: DocumentServiceError.DOCUMENT_NOT_FOUND, message: 'Document not found' });

    const now = new Date().toISOString();
    const fraudFlags: DocumentFraudFlag[] = [];

    // Check 1: File size anomalies
    if (doc.size === 0) {
      fraudFlags.push({ type: 'suspicious_format', severity: 'high', description: 'Document has zero file size', details: { size: doc.size }, detectedAt: now });
    }

    // Check 2: MIME type / extension mismatch
    const mimeExtMap: Record<string, string[]> = {
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/tiff': ['.tif', '.tiff'],
    };
    const expectedExts = mimeExtMap[doc.mimeType];
    if (expectedExts) {
      const ext = doc.name.toLowerCase().substring(doc.name.lastIndexOf('.'));
      if (!expectedExts.includes(ext)) {
        fraudFlags.push({ type: 'suspicious_format', severity: 'medium', description: `File extension (${ext}) does not match MIME type (${doc.mimeType})`, details: { expected: expectedExts, actual: ext }, detectedAt: now });
      }
    }

    // Check 3: Document expiry
    if (input.checkExpiry && doc.metadata.expiresAt) {
      const expiryDate = new Date(doc.metadata.expiresAt as string);
      if (expiryDate < new Date()) {
        fraudFlags.push({ type: 'expired_document', severity: 'high', description: 'Document has expired', details: { expiresAt: doc.metadata.expiresAt }, detectedAt: now });
      }
    }

    // Check 4: Date consistency (issue date vs expiry date)
    if (doc.metadata.issuedDate && doc.metadata.expiresAt) {
      const issued = new Date(doc.metadata.issuedDate as string);
      const expires = new Date(doc.metadata.expiresAt as string);
      if (expires <= issued) {
        fraudFlags.push({ type: 'date_inconsistency', severity: 'high', description: 'Expiry date is before or equal to issue date', details: { issuedDate: doc.metadata.issuedDate, expiresAt: doc.metadata.expiresAt }, detectedAt: now });
      }
    }

    // Check 5: Unusually large file for document type
    if (doc.category === 'id_document' && doc.size > 20_000_000) {
      fraudFlags.push({ type: 'suspicious_format', severity: 'low', description: 'ID document file size is unusually large (>20MB)', details: { size: doc.size }, detectedAt: now });
    }

    // Determine validation status
    let status: DocumentValidationStatus = 'valid';
    const hasCritical = fraudFlags.some(f => f.severity === 'critical');
    const hasHigh = fraudFlags.some(f => f.severity === 'high');
    const hasMedium = fraudFlags.some(f => f.severity === 'medium');

    if (hasCritical) status = 'invalid';
    else if (hasHigh) status = 'flagged';
    else if (hasMedium) status = 'requires_review';

    const result: DocumentValidationResult = {
      documentId, tenantId, status, isValid: status === 'valid',
      fraudFlags, validatedAt: now, validatedBy: verifiedBy,
      expiresAt: doc.metadata.expiresAt as string | null ?? null, notes: null,
    };

    // Update document metadata with validation results
    await this.documentRepo.update({
      ...doc,
      metadata: {
        ...doc.metadata,
        validationStatus: status,
        validationDate: now,
        fraudFlagCount: fraudFlags.length,
      },
    });

    // Publish fraud flag event if any flags detected
    if (fraudFlags.length > 0) {
      const highestSeverity = hasCritical ? 'critical' : hasHigh ? 'high' : hasMedium ? 'medium' : 'low';
      const event: DocumentFraudFlaggedEvent = {
        eventId: generateEventId(),
        eventType: 'DocumentFraudFlagged',
        timestamp: now,
        tenantId,
        correlationId,
        causationId: null,
        metadata: {},
        payload: {
          documentId,
          flagCount: fraudFlags.length,
          highestSeverity,
          flagTypes: fraudFlags.map(f => f.type),
        },
      };
      await this.eventBus.publish(createEventEnvelope(event, documentId, 'Document'));
    }

    return ok(result);
  }

  // ==================== Evidence Pack Compilation ====================

  /**
   * Compile an evidence pack from a set of documents.
   * Used for compliance cases, dispute resolution, and legal proceedings.
   */
  async getEvidencePack(
    tenantId: TenantId, title: string, documentIds: readonly DocumentId[],
    compiledBy: UserId, options?: { description?: string; caseId?: string; leaseId?: string },
    correlationId?: string
  ): Promise<Result<EvidencePack, DocumentServiceErrorResult>> {
    if (documentIds.length === 0) {
      return err({ code: DocumentServiceError.EVIDENCE_PACK_EMPTY, message: 'At least one document is required' });
    }

    const documents = await this.documentRepo.findByIds(documentIds, tenantId);
    const foundIds = new Set(documents.map(d => d.id));
    const missingIds = documentIds.filter(id => !foundIds.has(id));
    if (missingIds.length > 0) {
      return err({ code: DocumentServiceError.DOCUMENT_NOT_FOUND, message: `Documents not found: ${missingIds.join(', ')}` });
    }

    const now = new Date().toISOString();
    const items: EvidencePackItem[] = documents.map((doc, index) => ({
      documentId: doc.id, documentName: doc.name, category: doc.category,
      description: (doc.metadata.description as string) || doc.name,
      addedAt: now, addedBy: compiledBy, sortOrder: index + 1,
    }));

    const packId = `ep_${Date.now()}_${randomHex(4)}`;
    const evidencePack: EvidencePack = {
      id: packId, tenantId, title,
      description: options?.description ?? null,
      caseId: options?.caseId ?? null, leaseId: options?.leaseId ?? null,
      items, compiledBy, compiledAt: now, status: 'compiled',
    };

    const event: EvidencePackCompiledEvent = {
      eventId: generateEventId(), eventType: 'EvidencePackCompiled',
      timestamp: now, tenantId, correlationId: correlationId ?? '',
      causationId: null, metadata: {},
      payload: { packId, title, documentCount: items.length, caseId: options?.caseId ?? null },
    };
    await this.eventBus.publish(createEventEnvelope(event, packId, 'EvidencePack'));

    return ok(evidencePack);
  }

  // ==================== Version Tracking ====================

  /**
   * Upload a new version of an existing document.
   * Preserves the original document ID but creates a new version entry.
   * The main document record is updated to point to the latest version.
   */
  async uploadVersion(
    documentId: DocumentId,
    tenantId: TenantId,
    file: { originalName: string; mimeType: string; size: number; buffer: Buffer },
    uploadedBy: UserId,
    correlationId = ''
  ): Promise<Result<DocumentVersion, DocumentServiceErrorResult>> {
    const doc = await this.documentRepo.findById(documentId, tenantId);
    if (!doc) {
      return err({ code: DocumentServiceError.DOCUMENT_NOT_FOUND, message: 'Document not found' });
    }

    if (!this.documentRepo.createVersion || !this.documentRepo.getLatestVersion) {
      return err({
        code: DocumentServiceError.VERSION_NOT_SUPPORTED,
        message: 'Version tracking is not supported by the configured repository',
      });
    }

    // Determine next version number
    const latestVersion = await this.documentRepo.getLatestVersion(documentId, tenantId);
    const newVersionNumber = latestVersion ? latestVersion.version + 1 : 1;

    const storageKey = `${doc.category}/${documentId}/v${newVersionNumber}/${file.originalName}`;

    try {
      const uploadResult = await this.storage.upload({
        tenantId,
        key: storageKey,
        content: file.buffer,
        contentType: file.mimeType,
        metadata: {
          originalName: file.originalName,
          documentId,
          version: String(newVersionNumber),
        },
      });

      const now = new Date().toISOString();
      const version: DocumentVersion = {
        id: `ver_${documentId}_${newVersionNumber}`,
        documentId,
        tenantId,
        version: newVersionNumber,
        storageKey: uploadResult.key,
        url: uploadResult.url,
        name: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        metadata: { previousVersion: newVersionNumber - 1 },
        createdAt: now,
        createdBy: uploadedBy,
      };

      const savedVersion = await this.documentRepo.createVersion(version);

      // Update the main document to point to the latest version
      const updatedDoc: Document = {
        ...doc,
        storageKey: uploadResult.key,
        url: uploadResult.url,
        size: file.size,
        mimeType: file.mimeType,
        name: file.originalName,
        metadata: {
          ...doc.metadata,
          currentVersion: newVersionNumber,
          lastVersionedAt: now,
        },
      };
      await this.documentRepo.update(updatedDoc);

      // Publish upload event for the new version
      const event: DocumentUploadedEvent = {
        eventId: generateEventId(),
        eventType: 'DocumentUploaded',
        timestamp: now,
        tenantId,
        correlationId,
        causationId: null,
        metadata: { isNewVersion: true, version: newVersionNumber },
        payload: {
          documentId,
          category: doc.category,
          name: file.originalName,
          size: file.size,
        },
      };
      await this.eventBus.publish(createEventEnvelope(event, documentId, 'Document'));

      return ok(savedVersion);
    } catch (e) {
      return err({
        code: DocumentServiceError.UPLOAD_FAILED,
        message: e instanceof Error ? e.message : 'Version upload failed',
      });
    }
  }

  /**
   * Get all versions of a document, ordered by version number (ascending).
   */
  async getDocumentVersions(
    documentId: DocumentId,
    tenantId: TenantId
  ): Promise<Result<readonly DocumentVersion[], DocumentServiceErrorResult>> {
    const doc = await this.documentRepo.findById(documentId, tenantId);
    if (!doc) {
      return err({ code: DocumentServiceError.DOCUMENT_NOT_FOUND, message: 'Document not found' });
    }

    if (!this.documentRepo.findVersions) {
      // Return empty array if versioning is not supported
      return ok([]);
    }

    const versions = await this.documentRepo.findVersions(documentId, tenantId);
    return ok(versions);
  }

  /**
   * Get the latest version of a document.
   */
  async getLatestVersion(
    documentId: DocumentId,
    tenantId: TenantId
  ): Promise<Result<DocumentVersion | null, DocumentServiceErrorResult>> {
    const doc = await this.documentRepo.findById(documentId, tenantId);
    if (!doc) {
      return err({ code: DocumentServiceError.DOCUMENT_NOT_FOUND, message: 'Document not found' });
    }

    if (!this.documentRepo.getLatestVersion) {
      return ok(null);
    }

    const version = await this.documentRepo.getLatestVersion(documentId, tenantId);
    return ok(version);
  }

  // ==================== Signed URL ====================

  /** Generate signed URL for temporary access */
  async generateSignedUrl(
    documentId: DocumentId, tenantId: TenantId, expiresIn: number
  ): Promise<Result<string, DocumentServiceErrorResult>> {
    const doc = await this.documentRepo.findById(documentId, tenantId);
    if (!doc) return err({ code: DocumentServiceError.DOCUMENT_NOT_FOUND, message: 'Document not found' });

    try {
      const url = await this.storage.getSignedUrl(tenantId, doc.storageKey, { expiresIn });
      return ok(url);
    } catch (e) {
      return err({ code: DocumentServiceError.INVALID_INPUT, message: 'Failed to generate signed URL' });
    }
  }
}
