/**
 * Repository Interfaces for Document Intelligence Service
 * 
 * These interfaces define the contracts for data persistence operations.
 * Implementations can be provided for different storage backends
 * (PostgreSQL, MongoDB, in-memory, etc.)
 */

import type {
  DocumentId,
  DocumentUpload,
  DocumentType,
  DocumentStatus,
  UploadChannel,
  IdentityProfileId,
  TenantIdentityProfile,
  VerificationBadgeId,
  VerificationBadge,
  BadgeType,
  FraudRiskScoreId,
  FraudRiskScore,
  ValidationResultId,
  ValidationResult,
  EvidencePackId,
  EvidencePack,
  ExpiryTrackerId,
  ExpiryTracker,
  ExpiryType,
  OcrExtractionId,
  OCRExtractionResult,
  ISOTimestamp,
} from '../types/index.js';
import type { CustomerId, TenantId, LeaseId } from '@borjie/domain-models';

// ============================================================================
// Pagination Types
// ============================================================================

export interface PaginationParams {
  readonly page: number;
  readonly pageSize: number;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly hasMore: boolean;
}

// ============================================================================
// Document Repository
// ============================================================================

export interface DocumentFilter {
  readonly tenantId?: TenantId;
  readonly customerId?: CustomerId;
  readonly documentType?: DocumentType;
  readonly status?: DocumentStatus;
  readonly channel?: UploadChannel;
  readonly uploadedAfter?: ISOTimestamp;
  readonly uploadedBefore?: ISOTimestamp;
}

export interface IDocumentRepository {
  // CRUD
  create(document: DocumentUpload): Promise<DocumentUpload>;
  findById(id: DocumentId): Promise<DocumentUpload | null>;
  findByIds(ids: readonly DocumentId[]): Promise<readonly DocumentUpload[]>;
  update(id: DocumentId, updates: Partial<DocumentUpload>): Promise<DocumentUpload | null>;
  delete(id: DocumentId): Promise<boolean>;

  // Queries
  findByCustomer(customerId: CustomerId): Promise<readonly DocumentUpload[]>;
  findByTenant(tenantId: TenantId): Promise<readonly DocumentUpload[]>;
  findByFilter(filter: DocumentFilter, pagination: PaginationParams): Promise<PaginatedResult<DocumentUpload>>;
  
  // Specific queries
  findByOriginalChecksum(checksum: string): Promise<DocumentUpload | null>;
  findByStorageKey(storageKey: string): Promise<DocumentUpload | null>;
  findPendingReupload(customerId: CustomerId): Promise<readonly DocumentUpload[]>;
  countByCustomerAndType(customerId: CustomerId, documentType: DocumentType): Promise<number>;
}

// ============================================================================
// OCR Extraction Repository
// ============================================================================

export interface OCRExtractionFilter {
  readonly documentId?: DocumentId;
  readonly tenantId?: TenantId;
  readonly provider?: string;
  readonly status?: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface IOCRExtractionRepository {
  create(extraction: OCRExtractionResult): Promise<OCRExtractionResult>;
  findById(id: OcrExtractionId): Promise<OCRExtractionResult | null>;
  findByDocumentId(documentId: DocumentId): Promise<OCRExtractionResult | null>;
  update(id: OcrExtractionId, updates: Partial<OCRExtractionResult>): Promise<OCRExtractionResult | null>;
  delete(id: OcrExtractionId): Promise<boolean>;
  findByFilter(filter: OCRExtractionFilter, pagination: PaginationParams): Promise<PaginatedResult<OCRExtractionResult>>;
}

// ============================================================================
// Identity Profile Repository
// ============================================================================

export interface IdentityProfileFilter {
  readonly tenantId?: TenantId;
  readonly verificationStatus?: 'unverified' | 'partial' | 'complete' | 'expired';
  readonly completenessScoreMin?: number;
  readonly completenessScoreMax?: number;
}

export interface IIdentityProfileRepository {
  create(profile: TenantIdentityProfile): Promise<TenantIdentityProfile>;
  findById(id: IdentityProfileId): Promise<TenantIdentityProfile | null>;
  findByCustomerId(customerId: CustomerId): Promise<TenantIdentityProfile | null>;
  findByTenantId(tenantId: TenantId): Promise<TenantIdentityProfile | null>;
  update(id: IdentityProfileId, updates: Partial<TenantIdentityProfile>): Promise<TenantIdentityProfile | null>;
  delete(id: IdentityProfileId): Promise<boolean>;
  findByFilter(filter: IdentityProfileFilter, pagination: PaginationParams): Promise<PaginatedResult<TenantIdentityProfile>>;
  
  // Specific queries
  findByIdNumber(idNumber: string): Promise<TenantIdentityProfile | null>;
  findByEmail(email: string): Promise<readonly TenantIdentityProfile[]>;
  findByPhone(phone: string): Promise<readonly TenantIdentityProfile[]>;
}

// ============================================================================
// Verification Badge Repository
// ============================================================================

export interface VerificationBadgeFilter {
  readonly customerId?: CustomerId;
  readonly tenantId?: TenantId;
  readonly badgeType?: BadgeType;
  readonly isActive?: boolean;
  readonly awardedAfter?: ISOTimestamp;
  readonly awardedBefore?: ISOTimestamp;
}

export interface IVerificationBadgeRepository {
  create(badge: VerificationBadge): Promise<VerificationBadge>;
  findById(id: VerificationBadgeId): Promise<VerificationBadge | null>;
  findByIds(ids: readonly VerificationBadgeId[]): Promise<readonly VerificationBadge[]>;
  update(id: VerificationBadgeId, updates: Partial<VerificationBadge>): Promise<VerificationBadge | null>;
  delete(id: VerificationBadgeId): Promise<boolean>;

  // Queries
  findByCustomerId(customerId: CustomerId): Promise<readonly VerificationBadge[]>;
  findActiveByCustomerId(customerId: CustomerId): Promise<readonly VerificationBadge[]>;
  findByFilter(filter: VerificationBadgeFilter, pagination: PaginationParams): Promise<PaginatedResult<VerificationBadge>>;

  // Specific queries
  findByCustomerAndType(customerId: CustomerId, badgeType: BadgeType): Promise<VerificationBadge | null>;
  countActiveByCustomer(customerId: CustomerId): Promise<number>;
}

// ============================================================================
// Fraud Risk Score Repository
// ============================================================================

export interface FraudRiskScoreFilter {
  readonly documentId?: DocumentId;
  readonly customerId?: CustomerId;
  readonly tenantId?: TenantId;
  readonly riskLevel?: 'negligible' | 'low' | 'medium' | 'high' | 'critical';
  readonly reviewRequired?: boolean;
  readonly reviewStatus?: 'pending' | 'approved' | 'rejected';
}

export interface IFraudRiskScoreRepository {
  create(score: FraudRiskScore): Promise<FraudRiskScore>;
  findById(id: FraudRiskScoreId): Promise<FraudRiskScore | null>;
  findByDocumentId(documentId: DocumentId): Promise<FraudRiskScore | null>;
  update(id: FraudRiskScoreId, updates: Partial<FraudRiskScore>): Promise<FraudRiskScore | null>;
  delete(id: FraudRiskScoreId): Promise<boolean>;

  // Queries
  findByCustomerId(customerId: CustomerId): Promise<readonly FraudRiskScore[]>;
  findByFilter(filter: FraudRiskScoreFilter, pagination: PaginationParams): Promise<PaginatedResult<FraudRiskScore>>;

  // Specific queries
  findPendingReview(): Promise<readonly FraudRiskScore[]>;
  findHighRiskByCustomer(customerId: CustomerId): Promise<readonly FraudRiskScore[]>;
  countByRiskLevel(riskLevel: string): Promise<number>;
}

// ============================================================================
// Validation Result Repository
// ============================================================================

export interface ValidationResultFilter {
  readonly customerId?: CustomerId;
  readonly tenantId?: TenantId;
  readonly overallStatus?: 'passed' | 'failed' | 'warning' | 'skipped' | 'manual_review';
  readonly validatedAfter?: ISOTimestamp;
  readonly validatedBefore?: ISOTimestamp;
}

export interface IValidationResultRepository {
  create(result: ValidationResult): Promise<ValidationResult>;
  findById(id: ValidationResultId): Promise<ValidationResult | null>;
  findByCustomerId(customerId: CustomerId): Promise<readonly ValidationResult[]>;
  findLatestByCustomerId(customerId: CustomerId): Promise<ValidationResult | null>;
  update(id: ValidationResultId, updates: Partial<ValidationResult>): Promise<ValidationResult | null>;
  delete(id: ValidationResultId): Promise<boolean>;
  findByFilter(filter: ValidationResultFilter, pagination: PaginationParams): Promise<PaginatedResult<ValidationResult>>;
}

// ============================================================================
// Evidence Pack Repository
// ============================================================================

export interface EvidencePackFilter {
  readonly customerId?: CustomerId;
  readonly tenantId?: TenantId;
  readonly caseId?: string;
  readonly leaseId?: LeaseId;
  readonly type?: string;
  readonly status?: 'draft' | 'compiled' | 'submitted' | 'archived';
  readonly compiledAfter?: ISOTimestamp;
  readonly compiledBefore?: ISOTimestamp;
}

export interface IEvidencePackRepository {
  create(pack: EvidencePack): Promise<EvidencePack>;
  findById(id: EvidencePackId): Promise<EvidencePack | null>;
  update(id: EvidencePackId, updates: Partial<EvidencePack>): Promise<EvidencePack | null>;
  delete(id: EvidencePackId): Promise<boolean>;

  // Queries
  findByCustomerId(customerId: CustomerId): Promise<readonly EvidencePack[]>;
  findByCaseId(caseId: string): Promise<readonly EvidencePack[]>;
  findByLeaseId(leaseId: LeaseId): Promise<readonly EvidencePack[]>;
  findByFilter(filter: EvidencePackFilter, pagination: PaginationParams): Promise<PaginatedResult<EvidencePack>>;
}

// ============================================================================
// Expiry Tracker Repository
// ============================================================================

export interface ExpiryTrackerFilter {
  readonly customerId?: CustomerId;
  readonly tenantId?: TenantId;
  readonly documentId?: DocumentId;
  readonly expiryType?: ExpiryType;
  readonly status?: 'active' | 'expiring_soon' | 'expired' | 'renewed';
  readonly expiresAfter?: ISOTimestamp;
  readonly expiresBefore?: ISOTimestamp;
  readonly isAcknowledged?: boolean;
}

export interface IExpiryTrackerRepository {
  create(tracker: ExpiryTracker): Promise<ExpiryTracker>;
  findById(id: ExpiryTrackerId): Promise<ExpiryTracker | null>;
  update(id: ExpiryTrackerId, updates: Partial<ExpiryTracker>): Promise<ExpiryTracker | null>;
  delete(id: ExpiryTrackerId): Promise<boolean>;

  // Queries
  findByCustomerId(customerId: CustomerId): Promise<readonly ExpiryTracker[]>;
  findByDocumentId(documentId: DocumentId): Promise<ExpiryTracker | null>;
  findByFilter(filter: ExpiryTrackerFilter, pagination: PaginationParams): Promise<PaginatedResult<ExpiryTracker>>;

  // Specific queries
  findExpiringSoon(daysThreshold: number): Promise<readonly ExpiryTracker[]>;
  findExpired(): Promise<readonly ExpiryTracker[]>;
  findByStatus(status: 'active' | 'expiring_soon' | 'expired' | 'renewed'): Promise<readonly ExpiryTracker[]>;
  findUnacknowledgedExpired(): Promise<readonly ExpiryTracker[]>;
  countByStatusAndType(status: string, expiryType: ExpiryType): Promise<number>;
}

// ============================================================================
// External Provider Interfaces
// ============================================================================

export interface IStorageProvider {
  upload(key: string, data: Buffer, contentType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<boolean>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  exists(key: string): Promise<boolean>;
}

export interface IOCRProvider {
  extractText(imageBuffer: Buffer, options?: {
    language?: string;
    documentType?: string;
  }): Promise<{
    rawText: string;
    confidence: number;
    blocks: readonly {
      text: string;
      confidence: number;
      boundingBox?: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    }[];
    extractedFields: Record<string, string>;
  }>;
}

export interface IImageQualityAnalyzer {
  analyze(imageBuffer: Buffer): Promise<{
    resolution: { width: number; height: number };
    brightness: number;
    contrast: number;
    sharpness: number;
    blur: number;
    rotation: number;
    isAcceptable: boolean;
    issues: readonly string[];
  }>;
}

export interface IImageAnalyzer {
  analyzeIntegrity(imageBuffer: Buffer): Promise<{
    hasManipulation: boolean;
    manipulationScore: number;
    compressionLevel: number;
    hasMetadataAnomalies: boolean;
    fontConsistency: number;
    details: Record<string, unknown>;
  }>;
}

export interface INotificationService {
  sendReuploadRequest(params: {
    customerId: CustomerId;
    documentType: DocumentType;
    reason: string;
    suggestions?: readonly string[];
  }): Promise<void>;

  sendExpiryReminder(params: {
    customerId: CustomerId;
    itemName: string;
    expiresAt: ISOTimestamp;
    daysUntilExpiry: number;
  }): Promise<void>;

  sendExpiryAlert(params: {
    customerId: CustomerId;
    itemName: string;
    expiredAt: ISOTimestamp;
    isUrgent: boolean;
  }): Promise<void>;

  sendMissingDocumentChaser(params: {
    customerId: CustomerId;
    missingDocuments: readonly DocumentType[];
    deadline?: ISOTimestamp;
  }): Promise<void>;

  sendVerificationComplete(params: {
    customerId: CustomerId;
    badgesAwarded: readonly BadgeType[];
  }): Promise<void>;
}

export interface IExternalVerificationProvider {
  verifyIdentity(params: {
    idType: string;
    idNumber: string;
    fullName: string;
    dateOfBirth?: string;
    issuingCountry: string;
  }): Promise<{
    isValid: boolean;
    confidence: number;
    matchedFields: readonly string[];
    unmatchedFields: readonly string[];
    details?: Record<string, unknown>;
  }>;
}

export interface IPDFGenerator {
  generate(params: {
    title: string;
    sections: readonly {
      heading: string;
      content: string | Buffer;
      type: 'text' | 'image' | 'table';
    }[];
    metadata?: Record<string, string>;
    watermark?: string;
  }): Promise<Buffer>;
}
