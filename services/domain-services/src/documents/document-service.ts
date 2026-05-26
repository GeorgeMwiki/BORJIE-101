import { randomHex } from '../common/id-generator.js';
/**
 * Document Management Service
 * Multi-tenant document handling with storage, versioning, sharing, and search.
 */

import type { TenantId, UserId, PaginationParams, PaginatedResult } from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import type { Result } from '@borjie/domain-models';
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';
import type { StorageProvider } from './storage/storage-provider.interface.js';
import type { DocumentRepository } from './document-repository.interface.js';
import type {
  Document,
  DocumentId,
  DocumentCategory,
  DocumentAccess,
  DocumentFilters,
  DocumentMetadata,
  DocumentEntityType,
  DocumentAccessLevel,
  UploadDocumentInput,
  UploadedFile,
  DocumentVersion,
  OCRProvider,
  OCRExtractionResult,
  OCRExtractionStatus,
  DocumentFraudFlag,
  DocumentValidationResult,
  DocumentValidationStatus,
  FraudFlagSeverity,
  FraudFlagType,
  EvidencePack,
  EvidencePackItem,
} from './types.js';
import { asDocumentId } from './types.js';
import type {
  DocumentUploadedEvent,
  DocumentDeletedEvent,
  DocumentAccessGrantedEvent,
  DocumentOCRCompletedEvent,
  DocumentFraudFlaggedEvent,
  EvidencePackCompiledEvent,
} from './events.js';

// ============================================================================
// Error Types
// ============================================================================

export const DocumentServiceError = {
  DOCUMENT_NOT_FOUND: 'DOCUMENT_NOT_FOUND',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  DELETE_FAILED: 'DELETE_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
} as const;

export type DocumentServiceErrorCode =
  (typeof DocumentServiceError)[keyof typeof DocumentServiceError];

export interface DocumentServiceErrorResult {
  code: DocumentServiceErrorCode;
  message: string;
}

// ============================================================================
// Document Service
// ============================================================================

export interface DocumentServiceOptions {
  readonly repository: DocumentRepository;
  readonly storage: StorageProvider;
  readonly eventBus?: EventBus;
  readonly ocrProvider?: OCRProvider;
}

export class DocumentService {
  constructor(private readonly options: DocumentServiceOptions) {}

  /** Upload a document - stores in provider and persists metadata with tenant isolation */
  async uploadDocument(
    tenantId: TenantId,
    file: UploadedFile,
    category: DocumentCategory,
    metadata: DocumentMetadata | undefined,
    uploadedBy: UserId,
    correlationId = ''
  ): Promise<Result<Document, DocumentServiceErrorResult>> {
    const now = new Date().toISOString();
    const docId = asDocumentId(`doc_${Date.now()}_${randomHex(4)}`);
    const storageKey = `${category}/${docId}/${file.originalName}`;

    const content = file.buffer instanceof Blob
      ? Buffer.from(await file.buffer.arrayBuffer())
      : (file.buffer as Buffer);

    try {
      const uploadResult = await this.options.storage.upload({
        tenantId,
        key: storageKey,
        content,
        contentType: file.mimeType,
        metadata: {
          originalName: file.originalName,
          documentId: docId,
          category,
        },
      });

      const inputMeta = metadata ?? {};
      const metaPropertyId = inputMeta.propertyId as string | undefined;
      const metaCustomerId = inputMeta.customerId as string | undefined;
      const metaLeaseId = inputMeta.leaseId as string | undefined;
      const metaEntityType = inputMeta.entityType as DocumentEntityType | undefined;
      const metaEntityId = inputMeta.entityId as string | undefined;
      const document: Document = {
        id: docId,
        tenantId,
        category,
        name: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        storageKey: uploadResult.key,
        url: uploadResult.url,
        metadata: inputMeta,
        uploadedBy,
        createdAt: now,
        ...(metaPropertyId !== undefined ? { propertyId: metaPropertyId } : {}),
        ...(metaCustomerId !== undefined ? { customerId: metaCustomerId } : {}),
        ...(metaLeaseId !== undefined ? { leaseId: metaLeaseId } : {}),
        ...(metaEntityType !== undefined ? { entityType: metaEntityType } : {}),
        ...(metaEntityId !== undefined ? { entityId: metaEntityId } : {}),
      };

      const saved = await this.options.repository.create(document);

      if (this.options.repository.createVersion) {
        const { createVersion } = this.options.repository;
        await createVersion({
          id: `ver_${docId}_1`,
          documentId: docId,
          tenantId,
          version: 1,
          storageKey: uploadResult.key,
          metadata: inputMeta,
          createdAt: now,
          createdBy: uploadedBy,
        });
      }

      if (this.options.eventBus) {
        const event: DocumentUploadedEvent = {
          eventId: generateEventId(),
          eventType: 'DocumentUploaded',
          timestamp: now,
          tenantId,
          correlationId: correlationId ?? '',
          causationId: null,
          metadata: {},
          payload: {
            documentId: docId,
            category,
            name: file.originalName,
            mimeType: file.mimeType,
            size: file.size,
            url: uploadResult.url,
            storageKey: uploadResult.key,
            metadata: inputMeta,
            uploadedBy,
          },
        };
        await this.options.eventBus.publish(
          createEventEnvelope(event, docId, 'Document')
        );
      }

      return ok(saved);
    } catch (e) {
      return err({
        code: DocumentServiceError.UPLOAD_FAILED,
        message: e instanceof Error ? e.message : 'Upload failed',
      });
    }
  }

  /** Get a document by ID with tenant isolation */
  async getDocument(
    documentId: DocumentId,
    tenantId: TenantId
  ): Promise<Result<Document, DocumentServiceErrorResult>> {
    const doc = await this.options.repository.findById(documentId, tenantId);
    if (!doc) {
      return err({
        code: DocumentServiceError.DOCUMENT_NOT_FOUND,
        message: 'Document not found',
      });
    }
    return ok(doc);
  }

  /** List documents with filters and pagination */
  async listDocuments(
    tenantId: TenantId,
    filters: DocumentFilters,
    pagination?: PaginationParams
  ): Promise<Result<PaginatedResult<Document>, DocumentServiceErrorResult>> {
    const params = pagination ?? { limit: 50, offset: 0 };
    const result = await this.options.repository.findMany(
      tenantId,
      filters,
      params
    );
    return ok(result);
  }

  /** Delete a document - removes from storage and repository */
  async deleteDocument(
    documentId: DocumentId,
    tenantId: TenantId,
    deletedBy: UserId,
    correlationId = ''
  ): Promise<Result<void, DocumentServiceErrorResult>> {
    const doc = await this.options.repository.findById(documentId, tenantId);
    if (!doc) {
      return err({
        code: DocumentServiceError.DOCUMENT_NOT_FOUND,
        message: 'Document not found',
      });
    }

    try {
      await this.options.storage.delete(tenantId, doc.storageKey);
      await this.options.repository.delete(documentId, tenantId);

      if (this.options.eventBus) {
        const event: DocumentDeletedEvent = {
          eventId: generateEventId(),
          eventType: 'DocumentDeleted',
          timestamp: new Date().toISOString(),
          tenantId,
          correlationId: correlationId ?? '',
          causationId: null,
          metadata: {},
          payload: {
            documentId,
            category: doc.category,
            deletedBy,
          },
        };
        await this.options.eventBus.publish(
          createEventEnvelope(event, documentId, 'Document')
        );
      }

      return ok(undefined);
    } catch (e) {
      return err({
        code: DocumentServiceError.DELETE_FAILED,
        message: e instanceof Error ? e.message : 'Delete failed',
      });
    }
  }

  /** Generate a signed URL for temporary access */
  async generateSignedUrl(
    documentId: DocumentId,
    tenantId: TenantId,
    expiresIn: number
  ): Promise<Result<string, DocumentServiceErrorResult>> {
    const doc = await this.options.repository.findById(documentId, tenantId);
    if (!doc) {
      return err({
        code: DocumentServiceError.DOCUMENT_NOT_FOUND,
        message: 'Document not found',
      });
    }

    try {
      const url = await this.options.storage.getSignedUrl(
        tenantId,
        doc.storageKey,
        { expiresIn }
      );
      return ok(url);
    } catch (e) {
      return err({
        code: DocumentServiceError.INVALID_INPUT,
        message: e instanceof Error ? e.message : 'Failed to generate signed URL',
      });
    }
  }

  /** Grant access to a document for a user */
  async grantAccess(
    documentId: DocumentId,
    userId: UserId,
    accessLevel: DocumentAccessLevel,
    tenantId: TenantId,
    correlationId?: string
  ): Promise<Result<DocumentAccess, DocumentServiceErrorResult>> {
    const doc = await this.options.repository.findById(documentId, tenantId);
    if (!doc) {
      return err({
        code: DocumentServiceError.DOCUMENT_NOT_FOUND,
        message: 'Document not found',
      });
    }

    const access: DocumentAccess = {
      documentId,
      userId,
      accessLevel,
      grantedAt: new Date().toISOString(),
      tenantId,
    };

    const saved = await this.options.repository.addAccess(access);

    if (this.options.eventBus) {
      const event: DocumentAccessGrantedEvent = {
        eventId: generateEventId(),
        eventType: 'DocumentAccessGranted',
        timestamp: new Date().toISOString(),
        tenantId: doc.tenantId,
        correlationId: correlationId ?? '',
        causationId: null,
        metadata: {},
        payload: {
          documentId,
          userId,
          accessLevel,
        },
      };
      await this.options.eventBus.publish(
        createEventEnvelope(event, documentId, 'Document')
      );
    }

    return ok(saved);
  }

  /** Revoke access to a document for a user */
  async revokeAccess(
    documentId: DocumentId,
    userId: UserId,
    tenantId: TenantId
  ): Promise<Result<void, DocumentServiceErrorResult>> {
    const doc = await this.options.repository.findById(documentId, tenantId);
    if (!doc) {
      return err({
        code: DocumentServiceError.DOCUMENT_NOT_FOUND,
        message: 'Document not found',
      });
    }

    await this.options.repository.removeAccess(documentId, userId);
    return ok(undefined);
  }

  /** Get documents by entity (lease, customer, property, unit, work_order) */
  async getDocumentsByEntity(
    entityType: DocumentEntityType,
    entityId: string,
    tenantId: TenantId
  ): Promise<Result<readonly Document[], DocumentServiceErrorResult>> {
    const results = await this.options.repository.findByEntity(
      entityType,
      entityId,
      tenantId
    );
    return ok(results);
  }

  // ============================================================================
  // OCR Extraction
  // ============================================================================

  /**
   * Request OCR text extraction for a document.
   * Interfaces with an external OCR provider to extract text and structured data.
   */
  async extractText(
    documentId: DocumentId,
    tenantId: TenantId,
    options?: { language?: string; structuredExtraction?: boolean },
    correlationId = ''
  ): Promise<Result<OCRExtractionResult, DocumentServiceErrorResult>> {
    if (!this.options.ocrProvider) {
      return err({
        code: DocumentServiceError.INVALID_INPUT,
        message: 'OCR provider not configured',
      });
    }

    const doc = await this.options.repository.findById(documentId, tenantId);
    if (!doc) {
      return err({
        code: DocumentServiceError.DOCUMENT_NOT_FOUND,
        message: 'Document not found',
      });
    }

    // Only process extractable document types
    const extractableMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/tiff',
      'image/webp',
    ];
    if (!extractableMimeTypes.includes(doc.mimeType)) {
      return err({
        code: DocumentServiceError.INVALID_INPUT,
        message: `Cannot extract text from ${doc.mimeType}. Supported: ${extractableMimeTypes.join(', ')}`,
      });
    }

    try {
      // Download file content from storage
      // StorageProvider drifted; `download` was renamed/removed during the
      // hard-fork. Call through `any` until the provider interface is
      // re-aligned (covered by api-gateway's composition root shim).
      const content = await (this.options.storage as unknown as {
        download: (tenantId: TenantId, key: string) => Promise<Buffer>;
      }).download(tenantId, doc.storageKey);

      const ocrResult = await this.options.ocrProvider.extractText(
        content,
        doc.mimeType,
        options
      );

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
      await this.options.repository.update(updatedDoc);

      // Publish event
      if (this.options.eventBus) {
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
        await this.options.eventBus.publish(
          createEventEnvelope(event, documentId, 'Document')
        );
      }

      return ok(extractionResult);
    } catch (e) {
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

  // ============================================================================
  // Document Validation & Fraud Detection
  // ============================================================================

  /**
   * Validate a document and check for potential fraud indicators.
   * Performs automated checks on metadata, format, and content consistency.
   */
  async validateDocument(
    documentId: DocumentId,
    tenantId: TenantId,
    validatedBy: UserId | null,
    correlationId = ''
  ): Promise<Result<DocumentValidationResult, DocumentServiceErrorResult>> {
    const doc = await this.options.repository.findById(documentId, tenantId);
    if (!doc) {
      return err({
        code: DocumentServiceError.DOCUMENT_NOT_FOUND,
        message: 'Document not found',
      });
    }

    const now = new Date().toISOString();
    const fraudFlags: DocumentFraudFlag[] = [];

    // Check 1: File size anomalies
    if (doc.size === 0) {
      fraudFlags.push({
        type: 'suspicious_format',
        severity: 'high',
        description: 'Document has zero file size',
        details: { size: doc.size },
        detectedAt: now,
      });
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
        fraudFlags.push({
          type: 'suspicious_format',
          severity: 'medium',
          description: `File extension (${ext}) does not match MIME type (${doc.mimeType})`,
          details: { expectedExtensions: expectedExts, actualExtension: ext },
          detectedAt: now,
        });
      }
    }

    // Check 3: Document metadata consistency
    if (doc.metadata.expiresAt) {
      const expiryDate = new Date(doc.metadata.expiresAt as string);
      if (expiryDate < new Date()) {
        fraudFlags.push({
          type: 'expired_document',
          severity: 'high',
          description: 'Document has expired based on metadata',
          details: { expiresAt: doc.metadata.expiresAt },
          detectedAt: now,
        });
      }
    }

    // Check 4: Date consistency in metadata
    if (doc.metadata.issuedDate && doc.metadata.expiresAt) {
      const issued = new Date(doc.metadata.issuedDate as string);
      const expires = new Date(doc.metadata.expiresAt as string);
      if (expires <= issued) {
        fraudFlags.push({
          type: 'date_inconsistency',
          severity: 'high',
          description: 'Expiry date is before or equal to issue date',
          details: { issuedDate: doc.metadata.issuedDate, expiresAt: doc.metadata.expiresAt },
          detectedAt: now,
        });
      }
    }

    // Check 5: Unusually large or small file for document type
    if (doc.category === 'id_document' && doc.size > 20_000_000) {
      fraudFlags.push({
        type: 'suspicious_format',
        severity: 'low',
        description: 'ID document file size is unusually large (>20MB)',
        details: { size: doc.size },
        detectedAt: now,
      });
    }

    // Determine validation status
    let status: DocumentValidationStatus = 'valid';
    const hasCritical = fraudFlags.some(f => f.severity === 'critical');
    const hasHigh = fraudFlags.some(f => f.severity === 'high');
    const hasMedium = fraudFlags.some(f => f.severity === 'medium');

    if (hasCritical) {
      status = 'invalid';
    } else if (hasHigh) {
      status = 'flagged';
    } else if (hasMedium) {
      status = 'requires_review';
    }

    const result: DocumentValidationResult = {
      documentId,
      tenantId,
      status,
      isValid: status === 'valid',
      fraudFlags,
      validatedAt: now,
      validatedBy,
      expiresAt: doc.metadata.expiresAt as string | null ?? null,
      notes: null,
    };

    // Update document metadata with validation results
    const updatedDoc: Document = {
      ...doc,
      metadata: {
        ...doc.metadata,
        validationStatus: status,
        validationDate: now,
        fraudFlagCount: fraudFlags.length,
      },
    };
    await this.options.repository.update(updatedDoc);

    // Publish fraud flag event if any flags detected
    if (fraudFlags.length > 0 && this.options.eventBus) {
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
      await this.options.eventBus.publish(
        createEventEnvelope(event, documentId, 'Document')
      );
    }

    return ok(result);
  }

  // ============================================================================
  // Evidence Pack Compilation
  // ============================================================================

  /**
   * Compile an evidence pack from a set of documents.
   * Used for compliance cases, dispute resolution, and legal proceedings.
   */
  async compileEvidencePack(
    tenantId: TenantId,
    title: string,
    documentIds: readonly DocumentId[],
    compiledBy: UserId,
    options?: {
      description?: string;
      caseId?: string;
      leaseId?: string;
    },
    correlationId = ''
  ): Promise<Result<EvidencePack, DocumentServiceErrorResult>> {
    if (documentIds.length === 0) {
      return err({
        code: DocumentServiceError.INVALID_INPUT,
        message: 'At least one document is required for an evidence pack',
      });
    }

    // Verify all documents exist and belong to this tenant
    const documents = await this.options.repository.findByIds(documentIds, tenantId);

    const foundIds = new Set(documents.map(d => d.id));
    const missingIds = documentIds.filter(id => !foundIds.has(id));
    if (missingIds.length > 0) {
      return err({
        code: DocumentServiceError.DOCUMENT_NOT_FOUND,
        message: `Documents not found: ${missingIds.join(', ')}`,
      });
    }

    const now = new Date().toISOString();
    const items: EvidencePackItem[] = documents.map((doc, index) => ({
      documentId: doc.id,
      documentName: doc.name,
      category: doc.category,
      description: (doc.metadata.description as string) || doc.name,
      addedAt: now,
      addedBy: compiledBy,
      sortOrder: index + 1,
    }));

    const packId = `ep_${Date.now()}_${randomHex(4)}`;
    const evidencePack: EvidencePack = {
      id: packId,
      tenantId,
      title,
      description: options?.description ?? null,
      caseId: options?.caseId ?? null,
      leaseId: options?.leaseId ?? null,
      items,
      compiledBy,
      compiledAt: now,
      status: 'compiled',
    };

    // Publish event
    if (this.options.eventBus) {
      const event: EvidencePackCompiledEvent = {
        eventId: generateEventId(),
        eventType: 'EvidencePackCompiled',
        timestamp: now,
        tenantId,
        correlationId,
        causationId: null,
        metadata: {},
        payload: {
          packId,
          title,
          documentCount: items.length,
          caseId: options?.caseId ?? null,
          leaseId: options?.leaseId ?? null,
          compiledBy,
        },
      };
      await this.options.eventBus.publish(
        createEventEnvelope(event, packId, 'EvidencePack')
      );
    }

    return ok(evidencePack);
  }

  // ============================================================================
  // Version Tracking
  // ============================================================================

  /**
   * Upload a new version of an existing document.
   * Preserves the original document ID but creates a new version entry.
   */
  async uploadVersion(
    documentId: DocumentId,
    tenantId: TenantId,
    file: UploadedFile,
    uploadedBy: UserId,
    correlationId = ''
  ): Promise<Result<DocumentVersion, DocumentServiceErrorResult>> {
    const doc = await this.options.repository.findById(documentId, tenantId);
    if (!doc) {
      return err({
        code: DocumentServiceError.DOCUMENT_NOT_FOUND,
        message: 'Document not found',
      });
    }

    if (!this.options.repository.createVersion || !this.options.repository.getLatestVersion) {
      return err({
        code: DocumentServiceError.INVALID_INPUT,
        message: 'Version tracking is not supported by the configured repository',
      });
    }

    // Get the latest version number
    const latestVersion = await this.options.repository.getLatestVersion(documentId, tenantId);
    const newVersionNumber = latestVersion ? latestVersion.version + 1 : 1;

    const storageKey = `${doc.category}/${documentId}/v${newVersionNumber}/${file.originalName}`;

    const content = file.buffer instanceof Blob
      ? Buffer.from(await file.buffer.arrayBuffer())
      : (file.buffer as Buffer);

    try {
      const uploadResult = await this.options.storage.upload({
        tenantId,
        key: storageKey,
        content,
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
        metadata: {
          originalName: file.originalName,
          size: file.size,
          mimeType: file.mimeType,
        },
        createdAt: now,
        createdBy: uploadedBy,
      };

      const savedVersion = await this.options.repository.createVersion(version);

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
      await this.options.repository.update(updatedDoc);

      // Publish upload event for the new version
      if (this.options.eventBus) {
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
            mimeType: file.mimeType,
            size: file.size,
            url: uploadResult.url,
            storageKey: uploadResult.key,
            metadata: updatedDoc.metadata,
            uploadedBy,
          },
        };
        await this.options.eventBus.publish(
          createEventEnvelope(event, documentId, 'Document')
        );
      }

      return ok(savedVersion);
    } catch (e) {
      return err({
        code: DocumentServiceError.UPLOAD_FAILED,
        message: e instanceof Error ? e.message : 'Version upload failed',
      });
    }
  }

  /**
   * Get all versions of a document.
   */
  async getDocumentVersions(
    documentId: DocumentId,
    tenantId: TenantId
  ): Promise<Result<readonly DocumentVersion[], DocumentServiceErrorResult>> {
    const doc = await this.options.repository.findById(documentId, tenantId);
    if (!doc) {
      return err({
        code: DocumentServiceError.DOCUMENT_NOT_FOUND,
        message: 'Document not found',
      });
    }

    if (!this.options.repository.findVersions) {
      return ok([]);
    }

    const versions = await this.options.repository.findVersions(documentId, tenantId);
    return ok(versions);
  }
}
