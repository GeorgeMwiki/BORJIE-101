/**
 * Document Collection Service (Workflow G.1)
 * 
 * Handles multi-channel document upload, image quality validation,
 * re-upload request automation, and progress tracking per tenant.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  TenantId,
  UserId,
  CustomerId,
  DocumentId,
  DocumentUpload,
  DocumentType,
  UploadChannel,
  DocumentStatus,
  ImageQualityAssessment,
  ImageQualityStatus,
  DocumentCollectionProgress,
  ServiceResult,
} from '../types/index.js';
import { ok, err } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { generateDocumentId, generateChecksum } from '../utils/id-generator.js';

// ============================================================================
// Repository Interface
// ============================================================================

export interface IDocumentRepository {
  create(document: DocumentUpload): Promise<DocumentUpload>;
  findById(id: DocumentId, tenantId: TenantId): Promise<DocumentUpload | null>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId): Promise<readonly DocumentUpload[]>;
  update(document: DocumentUpload): Promise<DocumentUpload>;
  delete(id: DocumentId, tenantId: TenantId): Promise<void>;
  findDuplicateChecksum(checksum: string, tenantId: TenantId): Promise<DocumentUpload | null>;
}

// ============================================================================
// Storage Provider Interface
// ============================================================================

export interface IStorageProvider {
  upload(params: {
    tenantId: TenantId;
    key: string;
    content: Buffer;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<{ key: string; url: string }>;
  
  download(tenantId: TenantId, key: string): Promise<Buffer>;
  delete(tenantId: TenantId, key: string): Promise<void>;
  getSignedUrl(tenantId: TenantId, key: string, expiresIn: number): Promise<string>;
}

// ============================================================================
// Notification Service Interface (for re-upload requests)
// ============================================================================

export interface INotificationService {
  sendReuploadRequest(params: {
    customerId: CustomerId;
    tenantId: TenantId;
    documentType: DocumentType;
    reason: string;
    suggestions: string[];
    channel: UploadChannel;
  }): Promise<void>;
  
  sendProgressUpdate(params: {
    customerId: CustomerId;
    tenantId: TenantId;
    progress: DocumentCollectionProgress;
  }): Promise<void>;
}

// ============================================================================
// Image Quality Analyzer Interface
// ============================================================================

export interface IImageQualityAnalyzer {
  analyze(buffer: Buffer, mimeType: string): Promise<ImageQualityAssessment>;
}

// ============================================================================
// Service Configuration
// ============================================================================

export interface DocumentCollectionServiceConfig {
  readonly minImageQualityScore: number;
  readonly maxFileSizeMB: number;
  readonly allowedMimeTypes: readonly string[];
  readonly autoRejectPoorQuality: boolean;
  readonly maxReuploadAttempts: number;
}

const DEFAULT_CONFIG: DocumentCollectionServiceConfig = {
  minImageQualityScore: 0.6,
  maxFileSizeMB: 10,
  allowedMimeTypes: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'image/tiff',
  ],
  autoRejectPoorQuality: false,
  maxReuploadAttempts: 3,
};

// ============================================================================
// Document Collection Service
// ============================================================================

export interface DocumentCollectionServiceOptions {
  readonly repository: IDocumentRepository;
  readonly storage: IStorageProvider;
  readonly imageAnalyzer: IImageQualityAnalyzer;
  readonly notificationService?: INotificationService;
  readonly config?: Partial<DocumentCollectionServiceConfig>;
}

export class DocumentCollectionService {
  private readonly repository: IDocumentRepository;
  private readonly storage: IStorageProvider;
  private readonly imageAnalyzer: IImageQualityAnalyzer;
  private readonly notificationService?: INotificationService;
  private readonly config: DocumentCollectionServiceConfig;

  constructor(options: DocumentCollectionServiceOptions) {
    this.repository = options.repository;
    this.storage = options.storage;
    this.imageAnalyzer = options.imageAnalyzer;
    this.notificationService = options.notificationService;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  // ============================================================================
  // Multi-Channel Upload (WhatsApp, App, Email, Scan)
  // ============================================================================

  async uploadDocument(params: {
    tenantId: TenantId;
    customerId: CustomerId;
    uploadedBy: UserId;
    documentType: DocumentType;
    channel: UploadChannel;
    file: {
      buffer: Buffer;
      originalName: string;
      mimeType: string;
    };
    metadata?: Record<string, unknown>;
    expiresAt?: string;
  }): Promise<ServiceResult<DocumentUpload>> {
    const { tenantId, customerId, uploadedBy, documentType, channel, file, metadata, expiresAt } = params;
    const now = new Date().toISOString();

    logger.info('Starting document upload', {
      tenantId,
      customerId,
      documentType,
      channel,
      fileName: file.originalName,
      fileSize: file.buffer.length,
    });

    // Validate file size
    const fileSizeMB = file.buffer.length / (1024 * 1024);
    if (fileSizeMB > this.config.maxFileSizeMB) {
      return err(
        'FILE_TOO_LARGE',
        `File size ${fileSizeMB.toFixed(2)}MB exceeds maximum allowed ${this.config.maxFileSizeMB}MB`
      );
    }

    // Validate MIME type
    if (!this.config.allowedMimeTypes.includes(file.mimeType)) {
      return err(
        'INVALID_FILE_TYPE',
        `File type ${file.mimeType} is not allowed. Allowed types: ${this.config.allowedMimeTypes.join(', ')}`
      );
    }

    // Calculate checksum for duplicate detection
    const checksum = generateChecksum(file.buffer);

    // Check for duplicate uploads
    const existingDoc = await this.repository.findDuplicateChecksum(checksum, tenantId);
    if (existingDoc && existingDoc.customerId === customerId) {
      logger.warn('Duplicate document detected', {
        tenantId,
        customerId,
        existingDocId: existingDoc.id,
        checksum,
      });
      return err(
        'DUPLICATE_DOCUMENT',
        'This document has already been uploaded',
        { existingDocumentId: existingDoc.id }
      );
    }

    // Analyze image quality (for image files)
    let imageQuality: ImageQualityAssessment | null = null;
    if (file.mimeType.startsWith('image/')) {
      try {
        imageQuality = await this.imageAnalyzer.analyze(file.buffer, file.mimeType);
        logger.info('Image quality assessment completed', {
          tenantId,
          customerId,
          quality: imageQuality.status,
          score: imageQuality.score,
        });
      } catch (error) {
        logger.error('Image quality analysis failed', { error });
        // Continue without quality assessment
      }
    }

    // Determine initial status based on quality
    let status: DocumentStatus = 'uploaded';
    if (imageQuality && !imageQuality.isAcceptable) {
      if (this.config.autoRejectPoorQuality) {
        status = 'requires_reupload';
      } else {
        status = 'validating'; // Manual review needed
      }
    }

    // Generate document ID and storage key
    const documentId = generateDocumentId();
    const storageKey = `${tenantId}/${customerId}/${documentType}/${documentId}/${file.originalName}`;

    // Upload to storage
    let storageResult: { key: string; url: string };
    try {
      storageResult = await this.storage.upload({
        tenantId,
        key: storageKey,
        content: file.buffer,
        contentType: file.mimeType,
        metadata: {
          documentId,
          customerId,
          documentType,
          channel,
          originalName: file.originalName,
        },
      });
    } catch (error) {
      logger.error('Storage upload failed', { error, tenantId, customerId, documentType });
      return err('STORAGE_ERROR', 'Failed to store document');
    }

    // Create document record
    const document: DocumentUpload = {
      id: documentId,
      tenantId,
      customerId,
      documentType,
      channel,
      status,
      fileName: `${documentId}_${file.originalName}`,
      originalFileName: file.originalName,
      mimeType: file.mimeType,
      fileSize: file.buffer.length,
      storageKey: storageResult.key,
      storageUrl: storageResult.url,
      checksum,
      imageQuality,
      metadata: metadata ?? {},
      uploadedBy,
      uploadedAt: now,
      processedAt: null,
      expiresAt: expiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const savedDocument = await this.repository.create(document);

    // Send notification if quality is poor
    if (status === 'requires_reupload' && this.notificationService) {
      await this.sendReuploadRequest(savedDocument, imageQuality!);
    }

    logger.info('Document upload completed', {
      documentId: savedDocument.id,
      tenantId,
      customerId,
      status: savedDocument.status,
    });

    return ok(savedDocument);
  }

  // ============================================================================
  // Image Quality Validation
  // ============================================================================

  async validateImageQuality(
    documentId: DocumentId,
    tenantId: TenantId
  ): Promise<ServiceResult<ImageQualityAssessment>> {
    const document = await this.repository.findById(documentId, tenantId);
    if (!document) {
      return err('DOCUMENT_NOT_FOUND', 'Document not found');
    }

    if (!document.mimeType.startsWith('image/')) {
      return err('NOT_AN_IMAGE', 'Document is not an image file');
    }

    try {
      const content = await this.storage.download(tenantId, document.storageKey);
      const assessment = await this.imageAnalyzer.analyze(content, document.mimeType);

      // Update document with quality assessment
      const updatedDocument: DocumentUpload = {
        ...document,
        imageQuality: assessment,
        status: assessment.isAcceptable ? document.status : 'requires_reupload',
        updatedAt: new Date().toISOString(),
      };

      await this.repository.update(updatedDocument);

      return ok(assessment);
    } catch (error) {
      logger.error('Image quality validation failed', { error, documentId, tenantId });
      return err('VALIDATION_ERROR', 'Failed to validate image quality');
    }
  }

  // ============================================================================
  // Re-upload Request Automation
  // ============================================================================

  private async sendReuploadRequest(
    document: DocumentUpload,
    quality: ImageQualityAssessment
  ): Promise<void> {
    if (!this.notificationService) return;

    const reason = this.formatQualityIssues(quality);
    const suggestions = quality.suggestions as string[];

    try {
      await this.notificationService.sendReuploadRequest({
        customerId: document.customerId,
        tenantId: document.tenantId,
        documentType: document.documentType,
        reason,
        suggestions,
        channel: document.channel,
      });

      logger.info('Re-upload request sent', {
        documentId: document.id,
        customerId: document.customerId,
        reason,
      });
    } catch (error) {
      logger.error('Failed to send re-upload request', { error, documentId: document.id });
    }
  }

  async requestReupload(params: {
    documentId: DocumentId;
    tenantId: TenantId;
    reason: string;
    suggestions?: string[];
  }): Promise<ServiceResult<void>> {
    const { documentId, tenantId, reason, suggestions } = params;

    const document = await this.repository.findById(documentId, tenantId);
    if (!document) {
      return err('DOCUMENT_NOT_FOUND', 'Document not found');
    }

    // Update document status
    const updatedDocument: DocumentUpload = {
      ...document,
      status: 'requires_reupload',
      updatedAt: new Date().toISOString(),
    };

    await this.repository.update(updatedDocument);

    // Send notification
    if (this.notificationService) {
      await this.notificationService.sendReuploadRequest({
        customerId: document.customerId,
        tenantId: document.tenantId,
        documentType: document.documentType,
        reason,
        suggestions: suggestions ?? [],
        channel: document.channel,
      });
    }

    return ok(undefined);
  }

  // ============================================================================
  // Progress Tracking Per Tenant
  // ============================================================================

  async getCollectionProgress(
    customerId: CustomerId,
    tenantId: TenantId,
    requiredDocumentTypes: readonly DocumentType[]
  ): Promise<ServiceResult<DocumentCollectionProgress>> {
    const documents = await this.repository.findByCustomer(customerId, tenantId);

    const requiredDocuments = requiredDocumentTypes.map(documentType => {
      const doc = documents.find(
        d => d.documentType === documentType && d.status !== 'rejected'
      );

      let status: 'pending' | 'uploaded' | 'verified' | 'rejected' = 'pending';
      if (doc) {
        if (doc.status === 'verified') {
          status = 'verified';
        } else if (doc.status === 'rejected' || doc.status === 'requires_reupload') {
          status = 'rejected';
        } else {
          status = 'uploaded';
        }
      }

      return {
        documentType,
        required: true,
        status,
        documentId: doc?.id ?? null,
        uploadedAt: doc?.uploadedAt ?? null,
      };
    });

    const totalRequired = requiredDocuments.length;
    const totalUploaded = requiredDocuments.filter(d => d.status !== 'pending').length;
    const totalVerified = requiredDocuments.filter(d => d.status === 'verified').length;
    const completionPercentage = totalRequired > 0
      ? Math.round((totalVerified / totalRequired) * 100)
      : 0;

    const progress: DocumentCollectionProgress = {
      customerId,
      tenantId,
      requiredDocuments,
      totalRequired,
      totalUploaded,
      totalVerified,
      completionPercentage,
      isComplete: totalVerified === totalRequired,
      lastUpdatedAt: new Date().toISOString(),
    };

    // Optionally notify about progress
    if (this.notificationService && totalUploaded > 0) {
      await this.notificationService.sendProgressUpdate({
        customerId,
        tenantId,
        progress,
      });
    }

    return ok(progress);
  }

  // ============================================================================
  // Document Status Updates
  // ============================================================================

  async updateDocumentStatus(
    documentId: DocumentId,
    tenantId: TenantId,
    status: DocumentStatus
  ): Promise<ServiceResult<DocumentUpload>> {
    const document = await this.repository.findById(documentId, tenantId);
    if (!document) {
      return err('DOCUMENT_NOT_FOUND', 'Document not found');
    }

    const now = new Date().toISOString();
    const updatedDocument: DocumentUpload = {
      ...document,
      status,
      processedAt: ['verified', 'rejected'].includes(status) ? now : document.processedAt,
      updatedAt: now,
    };

    const saved = await this.repository.update(updatedDocument);
    return ok(saved);
  }

  // ============================================================================
  // Document Retrieval
  // ============================================================================

  async getDocument(
    documentId: DocumentId,
    tenantId: TenantId
  ): Promise<ServiceResult<DocumentUpload>> {
    const document = await this.repository.findById(documentId, tenantId);
    if (!document) {
      return err('DOCUMENT_NOT_FOUND', 'Document not found');
    }
    return ok(document);
  }

  async getDocumentsByCustomer(
    customerId: CustomerId,
    tenantId: TenantId
  ): Promise<ServiceResult<readonly DocumentUpload[]>> {
    const documents = await this.repository.findByCustomer(customerId, tenantId);
    return ok(documents);
  }

  async getSignedDownloadUrl(
    documentId: DocumentId,
    tenantId: TenantId,
    expiresIn: number = 3600
  ): Promise<ServiceResult<string>> {
    const document = await this.repository.findById(documentId, tenantId);
    if (!document) {
      return err('DOCUMENT_NOT_FOUND', 'Document not found');
    }

    try {
      const url = await this.storage.getSignedUrl(tenantId, document.storageKey, expiresIn);
      return ok(url);
    } catch (error) {
      logger.error('Failed to generate signed URL', { error, documentId, tenantId });
      return err('URL_GENERATION_ERROR', 'Failed to generate download URL');
    }
  }

  // ============================================================================
  // Document Deletion
  // ============================================================================

  async deleteDocument(
    documentId: DocumentId,
    tenantId: TenantId
  ): Promise<ServiceResult<void>> {
    const document = await this.repository.findById(documentId, tenantId);
    if (!document) {
      return err('DOCUMENT_NOT_FOUND', 'Document not found');
    }

    try {
      await this.storage.delete(tenantId, document.storageKey);
      await this.repository.delete(documentId, tenantId);

      logger.info('Document deleted', { documentId, tenantId });
      return ok(undefined);
    } catch (error) {
      logger.error('Failed to delete document', { error, documentId, tenantId });
      return err('DELETE_ERROR', 'Failed to delete document');
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private formatQualityIssues(quality: ImageQualityAssessment): string {
    const issues = quality.issues as string[];
    if (issues.length === 0) {
      return `Image quality score (${(quality.score * 100).toFixed(0)}%) is below acceptable threshold`;
    }
    return `Document image has the following issues: ${issues.join(', ')}`;
  }
}

// ============================================================================
// Mock Image Quality Analyzer (for testing)
// ============================================================================

export class MockImageQualityAnalyzer implements IImageQualityAnalyzer {
  async analyze(buffer: Buffer, mimeType: string): Promise<ImageQualityAssessment> {
    // Simple mock analysis based on file size
    const sizeMB = buffer.length / (1024 * 1024);
    
    let status: ImageQualityStatus = 'good';
    let score = 0.9;
    const issues: string[] = [];
    const suggestions: string[] = [];

    // Simulate quality checks
    if (sizeMB < 0.05) {
      status = 'poor';
      score = 0.3;
      issues.push('Image resolution appears too low');
      suggestions.push('Please upload a higher resolution image (at least 1000x800 pixels)');
    } else if (sizeMB < 0.1) {
      status = 'acceptable';
      score = 0.7;
      issues.push('Image resolution is marginal');
      suggestions.push('A higher resolution image would improve readability');
    }

    return {
      status,
      score,
      issues,
      suggestions,
      isAcceptable: score >= 0.6,
    };
  }
}
