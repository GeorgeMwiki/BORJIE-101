/**
 * Document Intelligence & Identity Verification Service
 * 
 * This module provides comprehensive document processing, identity verification,
 * and fraud detection capabilities for the BORJIE property management platform.
 * 
 * Implements Module G from the BORJIE specification:
 * - G.1: Document Collection Service (multi-channel upload, quality validation)
 * - G.2: OCR & Data Extraction (AWS Textract/Google Vision integration)
 * - G.3: Fraud Detection Engine (integrity checks, anomaly detection)
 * - G.4: Validation & Consistency Service (cross-document validation)
 * - G.6: Expiry Tracking Service (document expiry monitoring)
 * - G.7: Evidence Pack Builder (legal evidence compilation)
 */

// ============================================================================
// Types & Schemas
// ============================================================================
export * from './types/index.js';

// ============================================================================
// Repository Interfaces
// ============================================================================
export * from './repositories/interfaces.js';

// ============================================================================
// Services
// ============================================================================
export { DocumentCollectionService, MockImageQualityAnalyzer } from './services/document-collection.service.js';
export { OCRExtractionService, MockOCRProvider } from './services/ocr-extraction.service.js';
export { FraudDetectionService, MockImageAnalyzer } from './services/fraud-detection.service.js';
export { ValidationConsistencyService, type IExternalVerificationProvider } from './services/validation-consistency.service.js';
export { EvidencePackBuilderService, MockPDFGenerator } from './services/evidence-pack-builder.service.js';
export { ExpiryTrackingService } from './services/expiry-tracking.service.js';

// ============================================================================
// API Routes
// ============================================================================
export {
  documentIntelligenceRoutes,
  createDocumentIntelligenceRoutes,
  // Request/Response schemas
  uploadDocumentSchema,
  verifyDocumentSchema,
  verifyBatchSchema,
  validateCustomerSchema,
  generateEvidencePackSchema,
  generateQuickPackSchema,
  createBadgeSchema,
  revokeBadgeSchema,
  requestReuploadSchema,
  recordFraudReviewSchema,
  recordValidationReviewSchema,
  createExpiryTrackerSchema,
  sendMissingDocChaserSchema,
  // Param/Query schemas
  documentIdParamSchema,
  customerIdParamSchema,
  packIdParamSchema,
  badgeIdParamSchema,
  trackerIdParamSchema,
  fraudScoreIdParamSchema,
  validationIdParamSchema,
  paginationQuerySchema,
  documentListQuerySchema,
  expiryQuerySchema,
  // Types
  type UploadDocumentInput,
  type VerifyDocumentInput,
  type VerifyBatchInput,
  type ValidateCustomerInput,
  type GenerateEvidencePackInput,
  type GenerateQuickPackInput,
  type CreateBadgeInput,
  type RevokeBadgeInput,
  type RequestReuploadInput,
  type RecordFraudReviewInput,
  type RecordValidationReviewInput,
  type CreateExpiryTrackerInput,
  type SendMissingDocChaserInput,
  // Helpers
  errorResponse,
  successResponse,
  validationErrorHook,
} from './routes/documents.routes.js';

// ============================================================================
// Utilities
// ============================================================================
export { logger } from './utils/logger.js';
export {
  generateDocumentId,
  generateIdentityProfileId,
  generateVerificationBadgeId,
  generateFraudRiskScoreId,
  generateEvidencePackId,
  generateExpiryTrackerId,
  generateValidationResultId,
  generateOCRExtractionId,
  generateChecksum,
} from './utils/id-generator.js';
export {
  levenshteinDistance,
  jaroWinklerSimilarity,
  normalizeName,
  extractNameParts,
  matchNames,
  normalizeIdNumber,
  matchIdNumbers,
  validateIdFormat,
} from './utils/name-matcher.js';

// ============================================================================
// Version
// ============================================================================
export const VERSION = '1.0.0';
export const MODULE_NAME = 'Document Intelligence & Identity Verification';
export const MODULE_CODE = 'G';
