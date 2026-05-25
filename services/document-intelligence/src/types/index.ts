/**
 * Document Intelligence & Identity Verification Types
 * BORJIE Module G - Core type definitions
 */

import { z } from 'zod';

// ============================================================================
// Brand Types for Type-Safe IDs
// ============================================================================

export type Brand<T, B> = T & { __brand: B };

export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type CustomerId = Brand<string, 'CustomerId'>;
export type DocumentId = Brand<string, 'DocumentId'>;
export type IdentityProfileId = Brand<string, 'IdentityProfileId'>;
export type VerificationBadgeId = Brand<string, 'VerificationBadgeId'>;
export type FraudRiskScoreId = Brand<string, 'FraudRiskScoreId'>;
export type EvidencePackId = Brand<string, 'EvidencePackId'>;
export type ExpiryTrackerId = Brand<string, 'ExpiryTrackerId'>;
export type ValidationResultId = Brand<string, 'ValidationResultId'>;
export type OcrExtractionId = Brand<string, 'OcrExtractionId'>;

export function asTenantId(id: string): TenantId { return id as TenantId; }
export function asUserId(id: string): UserId { return id as UserId; }
export function asCustomerId(id: string): CustomerId { return id as CustomerId; }
export function asDocumentId(id: string): DocumentId { return id as DocumentId; }
export function asIdentityProfileId(id: string): IdentityProfileId { return id as IdentityProfileId; }
export function asVerificationBadgeId(id: string): VerificationBadgeId { return id as VerificationBadgeId; }
export function asFraudRiskScoreId(id: string): FraudRiskScoreId { return id as FraudRiskScoreId; }
export function asEvidencePackId(id: string): EvidencePackId { return id as EvidencePackId; }
export function asExpiryTrackerId(id: string): ExpiryTrackerId { return id as ExpiryTrackerId; }
export function asValidationResultId(id: string): ValidationResultId { return id as ValidationResultId; }

export type ISOTimestamp = string;

// ============================================================================
// Document Upload & Collection Types (Workflow G.1)
// ============================================================================

export const UploadChannelSchema = z.enum([
  'whatsapp',
  'mobile_app',
  'web_app',
  'email',
  'scan',
  'api',
]);
export type UploadChannel = z.infer<typeof UploadChannelSchema>;

export const DocumentTypeSchema = z.enum([
  'national_id',
  'passport',
  'drivers_license',
  'utility_bill',
  'bank_statement',
  'employment_letter',
  'payslip',
  'lease_agreement',
  'signed_lease',
  'move_in_report',
  'move_out_report',
  'inspection_report',
  'receipt',
  'invoice',
  'guarantor_document',
  'police_clearance',
  'residence_permit',
  'work_permit',
  'other',
]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const DocumentStatusSchema = z.enum([
  'pending_upload',
  'uploading',
  'uploaded',
  'validating',
  'ocr_processing',
  'ocr_completed',
  'fraud_check',
  'verified',
  'rejected',
  'requires_reupload',
  'expired',
]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const ImageQualityStatusSchema = z.enum([
  'good',
  'acceptable',
  'poor',
  'unreadable',
  'blurry',
  'too_dark',
  'too_bright',
  'cropped',
  'wrong_orientation',
]);
export type ImageQualityStatus = z.infer<typeof ImageQualityStatusSchema>;

export interface ImageQualityAssessment {
  readonly status: ImageQualityStatus;
  readonly score: number; // 0-1
  readonly issues: readonly string[];
  readonly suggestions: readonly string[];
  readonly isAcceptable: boolean;
}

export const ImageQualityAssessmentSchema = z.object({
  status: ImageQualityStatusSchema,
  score: z.number().min(0).max(1),
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
  isAcceptable: z.boolean(),
});

export interface DocumentUpload {
  readonly id: DocumentId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly documentType: DocumentType;
  readonly channel: UploadChannel;
  readonly status: DocumentStatus;
  readonly fileName: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly fileSize: number;
  readonly storageKey: string;
  readonly storageUrl: string | null;
  readonly checksum: string;
  readonly imageQuality: ImageQualityAssessment | null;
  readonly metadata: Record<string, unknown>;
  readonly uploadedBy: UserId;
  readonly uploadedAt: ISOTimestamp;
  readonly processedAt: ISOTimestamp | null;
  readonly expiresAt: ISOTimestamp | null;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

export const DocumentUploadSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),
  documentType: DocumentTypeSchema,
  channel: UploadChannelSchema,
  status: DocumentStatusSchema,
  fileName: z.string(),
  originalFileName: z.string(),
  mimeType: z.string(),
  fileSize: z.number().nonnegative(),
  storageKey: z.string(),
  storageUrl: z.string().nullable(),
  checksum: z.string(),
  imageQuality: ImageQualityAssessmentSchema.nullable(),
  metadata: z.record(z.unknown()),
  uploadedBy: z.string(),
  uploadedAt: z.string().datetime(),
  processedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// ============================================================================
// OCR Extraction Types (Workflow G.2)
// ============================================================================

export const OCRProviderSchema = z.enum([
  'aws_textract',
  'google_vision',
  'azure_form_recognizer',
  'mock',
]);
export type OCRProvider = z.infer<typeof OCRProviderSchema>;

export const OCRStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
  'partial',
]);
export type OCRStatus = z.infer<typeof OCRStatusSchema>;

export interface ExtractedField {
  readonly fieldName: string;
  readonly value: string | null;
  readonly confidence: number;
  readonly boundingBox: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly normalized: boolean;
  readonly validationStatus: 'valid' | 'invalid' | 'uncertain';
}

export const ExtractedFieldSchema = z.object({
  fieldName: z.string(),
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  boundingBox: z.object({
    left: z.number(),
    top: z.number(),
    width: z.number(),
    height: z.number(),
  }).nullable(),
  normalized: z.boolean(),
  validationStatus: z.enum(['valid', 'invalid', 'uncertain']),
});

export interface OCRExtractionResult {
  readonly id: string;
  readonly documentId: DocumentId;
  readonly tenantId: TenantId;
  readonly provider: OCRProvider;
  readonly status: OCRStatus;
  readonly rawText: string | null;
  readonly extractedFields: readonly ExtractedField[];
  readonly structuredData: Record<string, unknown>;
  readonly confidence: number;
  readonly language: string | null;
  readonly pageCount: number;
  readonly processingTimeMs: number;
  readonly error: string | null;
  readonly processedAt: ISOTimestamp;
}

export const OCRExtractionResultSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  tenantId: z.string(),
  provider: OCRProviderSchema,
  status: OCRStatusSchema,
  rawText: z.string().nullable(),
  extractedFields: z.array(ExtractedFieldSchema),
  structuredData: z.record(z.unknown()),
  confidence: z.number().min(0).max(1),
  language: z.string().nullable(),
  pageCount: z.number().nonnegative(),
  processingTimeMs: z.number().nonnegative(),
  error: z.string().nullable(),
  processedAt: z.string().datetime(),
});

// ============================================================================
// Tenant Identity Profile (from OCR extraction)
// ============================================================================

export interface TenantIdentityProfile {
  readonly id: IdentityProfileId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly fullName: string;
  readonly firstName: string | null;
  readonly middleName: string | null;
  readonly lastName: string | null;
  readonly dateOfBirth: string | null;
  readonly gender: 'male' | 'female' | 'other' | null;
  readonly nationality: string | null;
  readonly idNumbers: readonly {
    readonly type: string;
    readonly number: string;
    readonly issuedAt: ISOTimestamp | null;
    readonly expiresAt: ISOTimestamp | null;
    readonly issuingCountry: string | null;
    readonly verified: boolean;
  }[];
  readonly addresses: readonly {
    readonly type: 'current' | 'permanent' | 'work';
    readonly line1: string;
    readonly line2: string | null;
    readonly city: string;
    readonly region: string | null;
    readonly postalCode: string | null;
    readonly country: string;
    readonly verified: boolean;
  }[];
  readonly contactInfo: {
    readonly primaryPhone: string | null;
    readonly secondaryPhone: string | null;
    readonly email: string | null;
    readonly whatsapp: string | null;
  };
  readonly employment: {
    readonly employer: string | null;
    readonly jobTitle: string | null;
    readonly employmentType: 'full_time' | 'part_time' | 'contract' | 'self_employed' | null;
    readonly monthlyIncome: number | null;
    readonly incomeCurrency: string | null;
    readonly verified: boolean;
  } | null;
  readonly photoUrl: string | null;
  readonly signatureUrl: string | null;
  readonly verificationStatus: 'pending' | 'partial' | 'complete' | 'failed';
  readonly completenessScore: number; // 0-100
  readonly lastVerifiedAt: ISOTimestamp | null;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

export const TenantIdentityProfileSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),
  fullName: z.string(),
  firstName: z.string().nullable(),
  middleName: z.string().nullable(),
  lastName: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  gender: z.enum(['male', 'female', 'other']).nullable(),
  nationality: z.string().nullable(),
  idNumbers: z.array(z.object({
    type: z.string(),
    number: z.string(),
    issuedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    issuingCountry: z.string().nullable(),
    verified: z.boolean(),
  })),
  addresses: z.array(z.object({
    type: z.enum(['current', 'permanent', 'work']),
    line1: z.string(),
    line2: z.string().nullable(),
    city: z.string(),
    region: z.string().nullable(),
    postalCode: z.string().nullable(),
    country: z.string(),
    verified: z.boolean(),
  })),
  contactInfo: z.object({
    primaryPhone: z.string().nullable(),
    secondaryPhone: z.string().nullable(),
    email: z.string().nullable(),
    whatsapp: z.string().nullable(),
  }),
  employment: z.object({
    employer: z.string().nullable(),
    jobTitle: z.string().nullable(),
    employmentType: z.enum(['full_time', 'part_time', 'contract', 'self_employed']).nullable(),
    monthlyIncome: z.number().nullable(),
    incomeCurrency: z.string().nullable(),
    verified: z.boolean(),
  }).nullable(),
  photoUrl: z.string().nullable(),
  signatureUrl: z.string().nullable(),
  verificationStatus: z.enum(['pending', 'partial', 'complete', 'failed']),
  completenessScore: z.number().min(0).max(100),
  lastVerifiedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// ============================================================================
// Verification Badges
// ============================================================================

export const BadgeTypeSchema = z.enum([
  'identity_verified',
  'address_verified',
  'income_verified',
  'employer_verified',
  'lease_signed',
  'payment_verified',
  'occupancy_started',
  'kyc_complete',
  'premium_tenant',
]);
export type BadgeType = z.infer<typeof BadgeTypeSchema>;

export interface VerificationBadge {
  readonly id: VerificationBadgeId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly identityProfileId: IdentityProfileId | null;
  readonly badgeType: BadgeType;
  readonly isActive: boolean;
  readonly awardedAt: ISOTimestamp;
  readonly awardedBy: UserId | null;
  readonly expiresAt: ISOTimestamp | null;
  readonly revokedAt: ISOTimestamp | null;
  readonly revokedBy: UserId | null;
  readonly revocationReason: string | null;
  readonly evidenceDocuments: readonly DocumentId[];
  readonly verificationMethod: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

export const VerificationBadgeSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),
  identityProfileId: z.string().nullable(),
  badgeType: BadgeTypeSchema,
  isActive: z.boolean(),
  awardedAt: z.string().datetime(),
  awardedBy: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  revokedBy: z.string().nullable(),
  revocationReason: z.string().nullable(),
  evidenceDocuments: z.array(z.string()),
  verificationMethod: z.string().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// ============================================================================
// Fraud Detection Types (Workflow G.3)
// ============================================================================

export const FraudRiskLevelSchema = z.enum([
  'low',
  'medium',
  'high',
  'critical',
]);
export type FraudRiskLevel = z.infer<typeof FraudRiskLevelSchema>;

export const FraudIndicatorTypeSchema = z.enum([
  'metadata_tampering',
  'image_manipulation',
  'font_inconsistency',
  'kerning_anomaly',
  'compression_artifact',
  'copy_paste_detected',
  'date_inconsistency',
  'duplicate_document',
  'cross_tenant_duplicate',
  'identity_mismatch',
  'expired_document',
  'suspicious_format',
  'missing_security_features',
  'unusual_file_size',
  'exif_anomaly',
]);
export type FraudIndicatorType = z.infer<typeof FraudIndicatorTypeSchema>;

export interface FraudIndicator {
  readonly type: FraudIndicatorType;
  readonly severity: FraudRiskLevel;
  readonly description: string;
  readonly confidence: number;
  readonly evidence: string | null;
  readonly recommendation: string | null;
  readonly detectedAt: ISOTimestamp;
}

export const FraudIndicatorSchema = z.object({
  type: FraudIndicatorTypeSchema,
  severity: FraudRiskLevelSchema,
  description: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().nullable(),
  recommendation: z.string().nullable(),
  detectedAt: z.string().datetime(),
});

export interface FraudRiskScore {
  readonly id: FraudRiskScoreId;
  readonly tenantId: TenantId;
  readonly documentId: DocumentId | null;
  readonly customerId: CustomerId | null;
  readonly riskLevel: FraudRiskLevel;
  readonly score: number; // 0-1
  readonly indicators: readonly FraudIndicator[];
  readonly primaryIndicator: FraudIndicatorType | null;
  readonly modelVersion: string;
  readonly modelConfidence: number | null;
  readonly decision: 'approved' | 'rejected' | 'review_required' | null;
  readonly decisionReason: string | null;
  readonly reviewRequired: boolean;
  readonly reviewedAt: ISOTimestamp | null;
  readonly reviewedBy: UserId | null;
  readonly reviewNotes: string | null;
  readonly calculatedAt: ISOTimestamp;
  readonly createdAt: ISOTimestamp;
}

export const FraudRiskScoreSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  documentId: z.string().nullable(),
  customerId: z.string().nullable(),
  riskLevel: FraudRiskLevelSchema,
  score: z.number().min(0).max(1),
  indicators: z.array(FraudIndicatorSchema),
  primaryIndicator: FraudIndicatorTypeSchema.nullable(),
  modelVersion: z.string(),
  modelConfidence: z.number().nullable(),
  decision: z.enum(['approved', 'rejected', 'review_required']).nullable(),
  decisionReason: z.string().nullable(),
  reviewRequired: z.boolean(),
  reviewedAt: z.string().datetime().nullable(),
  reviewedBy: z.string().nullable(),
  reviewNotes: z.string().nullable(),
  calculatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

// ============================================================================
// Validation & Consistency Types (Workflow G.4)
// ============================================================================

export const ValidationCheckTypeSchema = z.enum([
  'name_matching',
  'id_number_verification',
  'date_alignment',
  'address_consistency',
  'phone_consistency',
  'email_consistency',
  'photo_match',
  'signature_match',
  'document_authenticity',
  'cross_document_consistency',
]);
export type ValidationCheckType = z.infer<typeof ValidationCheckTypeSchema>;

export const ValidationStatusSchema = z.enum([
  'passed',
  'failed',
  'warning',
  'skipped',
  'manual_review',
]);
export type ValidationStatus = z.infer<typeof ValidationStatusSchema>;

export interface ValidationCheck {
  readonly checkType: ValidationCheckType;
  readonly status: ValidationStatus;
  readonly score: number;
  readonly details: string;
  readonly sourceDocuments: readonly DocumentId[];
  readonly sourceFields: readonly string[];
  readonly expectedValue: string | null;
  readonly actualValue: string | null;
  readonly discrepancy: string | null;
}

export const ValidationCheckSchema = z.object({
  checkType: ValidationCheckTypeSchema,
  status: ValidationStatusSchema,
  score: z.number().min(0).max(1),
  details: z.string(),
  sourceDocuments: z.array(z.string()),
  sourceFields: z.array(z.string()),
  expectedValue: z.string().nullable(),
  actualValue: z.string().nullable(),
  discrepancy: z.string().nullable(),
});

export interface ValidationResult {
  readonly id: ValidationResultId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly documentIds: readonly DocumentId[];
  readonly overallStatus: ValidationStatus;
  readonly overallScore: number;
  readonly checks: readonly ValidationCheck[];
  readonly summary: string;
  readonly recommendations: readonly string[];
  readonly requiresManualReview: boolean;
  readonly reviewedAt: ISOTimestamp | null;
  readonly reviewedBy: UserId | null;
  readonly reviewNotes: string | null;
  readonly validatedAt: ISOTimestamp;
  readonly createdAt: ISOTimestamp;
}

export const ValidationResultSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),
  documentIds: z.array(z.string()),
  overallStatus: ValidationStatusSchema,
  overallScore: z.number().min(0).max(1),
  checks: z.array(ValidationCheckSchema),
  summary: z.string(),
  recommendations: z.array(z.string()),
  requiresManualReview: z.boolean(),
  reviewedAt: z.string().datetime().nullable(),
  reviewedBy: z.string().nullable(),
  reviewNotes: z.string().nullable(),
  validatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

// ============================================================================
// Evidence Pack Types (Workflow G.7)
// ============================================================================

export const EvidencePackTypeSchema = z.enum([
  'dispute_resolution',
  'eviction',
  'deposit_settlement',
  'insurance_claim',
  'legal_proceeding',
  'compliance_audit',
  'tenant_offboarding',
  'general',
]);
export type EvidencePackType = z.infer<typeof EvidencePackTypeSchema>;

export const EvidencePackStatusSchema = z.enum([
  'draft',
  'compiling',
  'compiled',
  'submitted',
  'archived',
]);
export type EvidencePackStatus = z.infer<typeof EvidencePackStatusSchema>;

export interface EvidencePackItem {
  readonly documentId: DocumentId;
  readonly documentName: string;
  readonly documentType: DocumentType;
  readonly category: string;
  readonly description: string;
  readonly eventDate: ISOTimestamp | null;
  readonly addedAt: ISOTimestamp;
  readonly addedBy: UserId;
  readonly sortOrder: number;
  readonly pageRange: string | null;
}

export const EvidencePackItemSchema = z.object({
  documentId: z.string(),
  documentName: z.string(),
  documentType: DocumentTypeSchema,
  category: z.string(),
  description: z.string(),
  eventDate: z.string().datetime().nullable(),
  addedAt: z.string().datetime(),
  addedBy: z.string(),
  sortOrder: z.number(),
  pageRange: z.string().nullable(),
});

export interface EvidencePack {
  readonly id: EvidencePackId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId | null;
  readonly leaseId: string | null;
  readonly caseId: string | null;
  readonly type: EvidencePackType;
  readonly title: string;
  readonly description: string | null;
  readonly status: EvidencePackStatus;
  readonly items: readonly EvidencePackItem[];
  readonly timeline: readonly {
    readonly date: ISOTimestamp;
    readonly event: string;
    readonly documentIds: readonly DocumentId[];
  }[];
  readonly pdfUrl: string | null;
  readonly pdfGeneratedAt: ISOTimestamp | null;
  readonly integrityHash: string | null;
  readonly compiledBy: UserId;
  readonly compiledAt: ISOTimestamp;
  readonly submittedAt: ISOTimestamp | null;
  readonly submittedTo: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

export const EvidencePackSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string().nullable(),
  leaseId: z.string().nullable(),
  caseId: z.string().nullable(),
  type: EvidencePackTypeSchema,
  title: z.string(),
  description: z.string().nullable(),
  status: EvidencePackStatusSchema,
  items: z.array(EvidencePackItemSchema),
  timeline: z.array(z.object({
    date: z.string().datetime(),
    event: z.string(),
    documentIds: z.array(z.string()),
  })),
  pdfUrl: z.string().nullable(),
  pdfGeneratedAt: z.string().datetime().nullable(),
  integrityHash: z.string().nullable(),
  compiledBy: z.string(),
  compiledAt: z.string().datetime(),
  submittedAt: z.string().datetime().nullable(),
  submittedTo: z.string().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// ============================================================================
// Expiry Tracking Types (Workflow G.6)
// ============================================================================

export const ExpiryTypeSchema = z.enum([
  'id_document',
  'lease',
  'work_permit',
  'residence_permit',
  'insurance',
  'license',
  'certificate',
  'contract',
]);
export type ExpiryType = z.infer<typeof ExpiryTypeSchema>;

export const ExpiryStatusSchema = z.enum([
  'active',
  'expiring_soon',
  'expired',
  'renewed',
]);
export type ExpiryStatus = z.infer<typeof ExpiryStatusSchema>;

export interface ExpiryTracker {
  readonly id: ExpiryTrackerId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly documentId: DocumentId | null;
  readonly expiryType: ExpiryType;
  readonly itemName: string;
  readonly itemDescription: string | null;
  readonly expiresAt: ISOTimestamp;
  readonly status: ExpiryStatus;
  readonly daysUntilExpiry: number;
  readonly remindersSent: number;
  readonly lastReminderAt: ISOTimestamp | null;
  readonly nextReminderAt: ISOTimestamp | null;
  readonly renewedAt: ISOTimestamp | null;
  readonly renewedDocumentId: DocumentId | null;
  readonly isAcknowledged: boolean;
  readonly acknowledgedAt: ISOTimestamp | null;
  readonly acknowledgedBy: UserId | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

export const ExpiryTrackerSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),
  documentId: z.string().nullable(),
  expiryType: ExpiryTypeSchema,
  itemName: z.string(),
  itemDescription: z.string().nullable(),
  expiresAt: z.string().datetime(),
  status: ExpiryStatusSchema,
  daysUntilExpiry: z.number(),
  remindersSent: z.number().nonnegative(),
  lastReminderAt: z.string().datetime().nullable(),
  nextReminderAt: z.string().datetime().nullable(),
  renewedAt: z.string().datetime().nullable(),
  renewedDocumentId: z.string().nullable(),
  isAcknowledged: z.boolean(),
  acknowledgedAt: z.string().datetime().nullable(),
  acknowledgedBy: z.string().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// ============================================================================
// Document Progress Tracking
// ============================================================================

export interface DocumentCollectionProgress {
  readonly customerId: CustomerId;
  readonly tenantId: TenantId;
  readonly requiredDocuments: readonly {
    readonly documentType: DocumentType;
    readonly required: boolean;
    readonly status: 'pending' | 'uploaded' | 'verified' | 'rejected';
    readonly documentId: DocumentId | null;
    readonly uploadedAt: ISOTimestamp | null;
  }[];
  readonly totalRequired: number;
  readonly totalUploaded: number;
  readonly totalVerified: number;
  readonly completionPercentage: number;
  readonly isComplete: boolean;
  readonly lastUpdatedAt: ISOTimestamp;
}

export const DocumentCollectionProgressSchema = z.object({
  customerId: z.string(),
  tenantId: z.string(),
  requiredDocuments: z.array(z.object({
    documentType: DocumentTypeSchema,
    required: z.boolean(),
    status: z.enum(['pending', 'uploaded', 'verified', 'rejected']),
    documentId: z.string().nullable(),
    uploadedAt: z.string().datetime().nullable(),
  })),
  totalRequired: z.number().nonnegative(),
  totalUploaded: z.number().nonnegative(),
  totalVerified: z.number().nonnegative(),
  completionPercentage: z.number().min(0).max(100),
  isComplete: z.boolean(),
  lastUpdatedAt: z.string().datetime(),
});

// ============================================================================
// Result Types
// ============================================================================

export interface ServiceResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

export function ok<T>(data: T): ServiceResult<T> {
  return { success: true, data };
}

export function err<T>(code: string, message: string, details?: unknown): ServiceResult<T> {
  return { success: false, error: { code, message, details } };
}
