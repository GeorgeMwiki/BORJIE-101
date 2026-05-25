/**
 * Validation & Consistency Service (Workflow G.4)
 * 
 * Performs cross-document validation:
 * - Name matching across documents
 * - ID number verification
 * - Lease date alignment
 * - Explainable verification output
 */

import type {
  TenantId,
  UserId,
  CustomerId,
  DocumentId,
  ValidationResultId,
  DocumentUpload,
  ValidationResult,
  ValidationCheck,
  ValidationCheckType,
  ValidationStatus,
  TenantIdentityProfile,
  ServiceResult,
} from '../types/index.js';
import { ok, err } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { generateValidationResultId } from '../utils/id-generator.js';
import {
  matchNames,
  matchIdNumbers,
  validateIdFormat,
  normalizeName,
} from '../utils/name-matcher.js';
import type { IDocumentRepository } from './document-collection.service.js';
import type {
  IIdentityProfileRepository,
  IOCRExtractionRepository,
} from './ocr-extraction.service.js';

// ============================================================================
// Repository Interface
// ============================================================================

export interface IValidationResultRepository {
  create(result: ValidationResult): Promise<ValidationResult>;
  findById(id: ValidationResultId, tenantId: TenantId): Promise<ValidationResult | null>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId): Promise<readonly ValidationResult[]>;
  findLatestByCustomer(customerId: CustomerId, tenantId: TenantId): Promise<ValidationResult | null>;
  update(result: ValidationResult): Promise<ValidationResult>;
}

// ============================================================================
// External Data Provider Interface (for ID verification)
// ============================================================================

export interface IExternalVerificationProvider {
  verifyIdNumber(params: {
    idType: string;
    idNumber: string;
    fullName: string;
    dateOfBirth?: string;
    country: string;
  }): Promise<{
    verified: boolean;
    confidence: number;
    details: string;
    matchedFields: string[];
    mismatchedFields: string[];
  }>;
}

// ============================================================================
// Service Configuration
// ============================================================================

export interface ValidationConsistencyConfig {
  readonly nameMatchThreshold: number;
  readonly minChecksForValidation: number;
  readonly autoApproveThreshold: number;
  readonly enableExternalVerification: boolean;
}

const DEFAULT_CONFIG: ValidationConsistencyConfig = {
  nameMatchThreshold: 0.85,
  minChecksForValidation: 3,
  autoApproveThreshold: 0.9,
  enableExternalVerification: false,
};

// ============================================================================
// Validation & Consistency Service
// ============================================================================

export interface ValidationConsistencyServiceOptions {
  readonly documentRepository: IDocumentRepository;
  readonly ocrExtractionRepository: IOCRExtractionRepository;
  readonly identityProfileRepository: IIdentityProfileRepository;
  readonly validationResultRepository: IValidationResultRepository;
  readonly externalVerificationProvider?: IExternalVerificationProvider;
  readonly config?: Partial<ValidationConsistencyConfig>;
}

export class ValidationConsistencyService {
  private readonly documentRepository: IDocumentRepository;
  private readonly ocrRepository: IOCRExtractionRepository;
  private readonly profileRepository: IIdentityProfileRepository;
  private readonly validationRepository: IValidationResultRepository;
  private readonly externalProvider?: IExternalVerificationProvider;
  private readonly config: ValidationConsistencyConfig;

  constructor(options: ValidationConsistencyServiceOptions) {
    this.documentRepository = options.documentRepository;
    this.ocrRepository = options.ocrExtractionRepository;
    this.profileRepository = options.identityProfileRepository;
    this.validationRepository = options.validationResultRepository;
    this.externalProvider = options.externalVerificationProvider;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  // ============================================================================
  // Main Validation Entry Point
  // ============================================================================

  async validateCustomerDocuments(
    customerId: CustomerId,
    tenantId: TenantId,
    documentIds?: readonly DocumentId[]
  ): Promise<ServiceResult<ValidationResult>> {
    logger.info('Starting customer document validation', {
      customerId,
      tenantId,
      documentCount: documentIds?.length ?? 'all',
    });

    // Get all customer documents if not specified
    let documents: readonly DocumentUpload[];
    if (documentIds) {
      const docs: DocumentUpload[] = [];
      for (const id of documentIds) {
        const doc = await this.documentRepository.findById(id, tenantId);
        if (doc) docs.push(doc);
      }
      documents = docs;
    } else {
      documents = await this.documentRepository.findByCustomer(customerId, tenantId);
    }

    if (documents.length === 0) {
      return err('NO_DOCUMENTS', 'No documents found for validation');
    }

    // Get identity profile
    const profile = await this.profileRepository.findByCustomer(customerId, tenantId);

    // Run all validation checks
    const checks: ValidationCheck[] = [];

    // 1. Name matching across documents
    const nameChecks = await this.performNameMatching(documents, profile);
    checks.push(...nameChecks);

    // 2. ID number verification
    const idChecks = await this.performIdNumberVerification(documents, profile);
    checks.push(...idChecks);

    // 3. Address consistency
    const addressChecks = await this.performAddressConsistency(documents, profile);
    checks.push(...addressChecks);

    // 4. Date alignment (lease dates, etc.)
    const dateChecks = await this.performDateAlignment(documents);
    checks.push(...dateChecks);

    // 5. Phone/email consistency
    const contactChecks = await this.performContactConsistency(documents, profile);
    checks.push(...contactChecks);

    // 6. Cross-document consistency
    const crossDocChecks = await this.performCrossDocumentConsistency(documents);
    checks.push(...crossDocChecks);

    // 7. External verification (if enabled)
    if (this.config.enableExternalVerification && this.externalProvider && profile) {
      const externalChecks = await this.performExternalVerification(profile);
      checks.push(...externalChecks);
    }

    // Calculate overall status and score
    const { overallStatus, overallScore, requiresManualReview } = this.calculateOverallStatus(checks);

    // Generate summary and recommendations
    const { summary, recommendations } = this.generateSummaryAndRecommendations(checks, overallStatus);

    const now = new Date().toISOString();

    const validationResult: ValidationResult = {
      id: generateValidationResultId(),
      tenantId,
      customerId,
      documentIds: documents.map(d => d.id),
      overallStatus,
      overallScore,
      checks,
      summary,
      recommendations,
      requiresManualReview,
      reviewedAt: null,
      reviewedBy: null,
      reviewNotes: null,
      validatedAt: now,
      createdAt: now,
    };

    const savedResult = await this.validationRepository.create(validationResult);

    logger.info('Document validation completed', {
      customerId,
      tenantId,
      resultId: savedResult.id,
      overallStatus,
      overallScore,
      checkCount: checks.length,
      passedCount: checks.filter(c => c.status === 'passed').length,
      failedCount: checks.filter(c => c.status === 'failed').length,
    });

    return ok(savedResult);
  }

  // ============================================================================
  // Name Matching Checks
  // ============================================================================

  private async performNameMatching(
    documents: readonly DocumentUpload[],
    profile: TenantIdentityProfile | null
  ): Promise<ValidationCheck[]> {
    const checks: ValidationCheck[] = [];
    const names: { source: DocumentId; name: string }[] = [];

    // Collect names from all documents
    for (const doc of documents) {
      const extraction = await this.ocrRepository.findByDocument(doc.id, doc.tenantId);
      if (!extraction) continue;

      const nameField = extraction.extractedFields.find(
        f => f.fieldName === 'full_name' || f.fieldName === 'name'
      );

      if (nameField?.value) {
        names.push({ source: doc.id, name: nameField.value });
      }
    }

    // Add profile name if exists
    if (profile?.fullName) {
      names.push({ source: profile.id as unknown as DocumentId, name: profile.fullName });
    }

    // Compare all pairs
    if (names.length >= 2) {
      for (let i = 0; i < names.length - 1; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const matchResult = matchNames(
            names[i].name,
            names[j].name,
            this.config.nameMatchThreshold
          );

          const status: ValidationStatus = matchResult.isMatch ? 'passed' : 'warning';

          checks.push({
            checkType: 'name_matching',
            status,
            score: matchResult.similarity,
            details: matchResult.details,
            sourceDocuments: [names[i].source, names[j].source],
            sourceFields: ['full_name'],
            expectedValue: names[i].name,
            actualValue: names[j].name,
            discrepancy: matchResult.isMatch ? null : `Similarity: ${(matchResult.similarity * 100).toFixed(1)}%`,
          });
        }
      }
    }

    // If no names found
    if (names.length === 0) {
      checks.push({
        checkType: 'name_matching',
        status: 'skipped',
        score: 0,
        details: 'No names extracted from documents to compare',
        sourceDocuments: [],
        sourceFields: ['full_name'],
        expectedValue: null,
        actualValue: null,
        discrepancy: null,
      });
    }

    return checks;
  }

  // ============================================================================
  // ID Number Verification
  // ============================================================================

  private async performIdNumberVerification(
    documents: readonly DocumentUpload[],
    profile: TenantIdentityProfile | null
  ): Promise<ValidationCheck[]> {
    const checks: ValidationCheck[] = [];

    // Get all ID documents
    const idDocuments = documents.filter(d =>
      ['national_id', 'passport', 'drivers_license'].includes(d.documentType)
    );

    for (const doc of idDocuments) {
      const extraction = await this.ocrRepository.findByDocument(doc.id, doc.tenantId);
      if (!extraction) continue;

      const idField = extraction.extractedFields.find(f => f.fieldName === 'id_number');
      if (!idField?.value) continue;

      // Validate format
      const formatValidation = validateIdFormat(idField.value, doc.documentType);

      checks.push({
        checkType: 'id_number_verification',
        status: formatValidation.isValid ? 'passed' : 'warning',
        score: formatValidation.isValid ? 1 : 0.5,
        details: formatValidation.details,
        sourceDocuments: [doc.id],
        sourceFields: ['id_number'],
        expectedValue: `Valid ${doc.documentType} format`,
        actualValue: idField.value,
        discrepancy: formatValidation.isValid ? null : formatValidation.details,
      });

      // Cross-check with profile if exists
      if (profile) {
        const matchingProfileId = profile.idNumbers.find(
          id => id.type === doc.documentType
        );

        if (matchingProfileId) {
          const idsMatch = matchIdNumbers(idField.value, matchingProfileId.number);

          checks.push({
            checkType: 'cross_document_consistency',
            status: idsMatch ? 'passed' : 'failed',
            score: idsMatch ? 1 : 0,
            details: idsMatch
              ? 'ID number matches profile record'
              : 'ID number does not match profile record',
            sourceDocuments: [doc.id],
            sourceFields: ['id_number'],
            expectedValue: matchingProfileId.number,
            actualValue: idField.value,
            discrepancy: idsMatch ? null : 'ID numbers do not match',
          });
        }
      }
    }

    return checks;
  }

  // ============================================================================
  // Address Consistency
  // ============================================================================

  private async performAddressConsistency(
    documents: readonly DocumentUpload[],
    profile: TenantIdentityProfile | null
  ): Promise<ValidationCheck[]> {
    const checks: ValidationCheck[] = [];
    const addresses: { source: DocumentId; address: string }[] = [];

    // Collect addresses from documents
    for (const doc of documents) {
      if (!['utility_bill', 'bank_statement', 'lease_agreement'].includes(doc.documentType)) {
        continue;
      }

      const extraction = await this.ocrRepository.findByDocument(doc.id, doc.tenantId);
      if (!extraction) continue;

      const addressField = extraction.extractedFields.find(
        f => f.fieldName === 'address' || f.fieldName === 'address_line1'
      );

      if (addressField?.value) {
        addresses.push({ source: doc.id, address: addressField.value });
      }
    }

    // Compare addresses
    if (addresses.length >= 2) {
      const normalizedAddresses = addresses.map(a => ({
        ...a,
        normalized: normalizeName(a.address),
      }));

      // Simple comparison - in production, use proper address matching
      const firstAddress = normalizedAddresses[0].normalized;
      const allMatch = normalizedAddresses.every(a =>
        a.normalized.includes(firstAddress.split(' ')[0]) ||
        firstAddress.includes(a.normalized.split(' ')[0])
      );

      checks.push({
        checkType: 'address_consistency',
        status: allMatch ? 'passed' : 'warning',
        score: allMatch ? 1 : 0.5,
        details: allMatch
          ? 'Addresses appear consistent across documents'
          : 'Addresses may differ across documents - manual review recommended',
        sourceDocuments: addresses.map(a => a.source),
        sourceFields: ['address'],
        expectedValue: addresses[0]?.address ?? null,
        actualValue: addresses.length > 1 ? addresses[1].address : null,
        discrepancy: allMatch ? null : 'Address variations detected',
      });
    }

    return checks;
  }

  // ============================================================================
  // Date Alignment
  // ============================================================================

  private async performDateAlignment(
    documents: readonly DocumentUpload[]
  ): Promise<ValidationCheck[]> {
    const checks: ValidationCheck[] = [];

    // Find lease document
    const leaseDoc = documents.find(d =>
      ['lease_agreement', 'signed_lease'].includes(d.documentType)
    );

    if (leaseDoc) {
      const leaseExtraction = await this.ocrRepository.findByDocument(leaseDoc.id, leaseDoc.tenantId);
      if (leaseExtraction) {
        const startDateField = leaseExtraction.extractedFields.find(
          f => f.fieldName === 'start_date' || f.fieldName === 'lease_start'
        );
        const endDateField = leaseExtraction.extractedFields.find(
          f => f.fieldName === 'end_date' || f.fieldName === 'lease_end'
        );

        if (startDateField?.value && endDateField?.value) {
          const startDate = new Date(startDateField.value);
          const endDate = new Date(endDateField.value);

          const isValidDateRange = endDate > startDate;

          checks.push({
            checkType: 'date_alignment',
            status: isValidDateRange ? 'passed' : 'failed',
            score: isValidDateRange ? 1 : 0,
            details: isValidDateRange
              ? 'Lease dates are valid and properly ordered'
              : 'Lease end date is before or equal to start date',
            sourceDocuments: [leaseDoc.id],
            sourceFields: ['start_date', 'end_date'],
            expectedValue: 'End date after start date',
            actualValue: `Start: ${startDateField.value}, End: ${endDateField.value}`,
            discrepancy: isValidDateRange ? null : 'Invalid date range',
          });
        }
      }
    }

    // Check ID document expiry dates
    for (const doc of documents) {
      if (!['national_id', 'passport', 'drivers_license'].includes(doc.documentType)) {
        continue;
      }

      const metadata = doc.metadata as Record<string, string>;
      if (metadata.expiresAt) {
        const expiryDate = new Date(metadata.expiresAt);
        const now = new Date();
        const isExpired = expiryDate < now;
        const daysUntilExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        let status: ValidationStatus = 'passed';
        let details = 'Document is valid and not expired';

        if (isExpired) {
          status = 'failed';
          details = 'Document has expired';
        } else if (daysUntilExpiry < 30) {
          status = 'warning';
          details = `Document expires in ${daysUntilExpiry} days`;
        }

        checks.push({
          checkType: 'date_alignment',
          status,
          score: isExpired ? 0 : daysUntilExpiry < 30 ? 0.7 : 1,
          details,
          sourceDocuments: [doc.id],
          sourceFields: ['expiry_date'],
          expectedValue: 'Valid (not expired)',
          actualValue: metadata.expiresAt,
          discrepancy: status !== 'passed' ? details : null,
        });
      }
    }

    return checks;
  }

  // ============================================================================
  // Contact Consistency
  // ============================================================================

  private async performContactConsistency(
    documents: readonly DocumentUpload[],
    profile: TenantIdentityProfile | null
  ): Promise<ValidationCheck[]> {
    const checks: ValidationCheck[] = [];

    if (!profile) return checks;

    const phones: string[] = [];
    const emails: string[] = [];

    // Collect contact info from documents
    for (const doc of documents) {
      const extraction = await this.ocrRepository.findByDocument(doc.id, doc.tenantId);
      if (!extraction) continue;

      const phoneField = extraction.extractedFields.find(f => f.fieldName === 'phone');
      const emailField = extraction.extractedFields.find(f => f.fieldName === 'email');

      if (phoneField?.value) phones.push(phoneField.value);
      if (emailField?.value) emails.push(emailField.value);
    }

    // Check phone consistency
    if (phones.length > 0 && profile.contactInfo.primaryPhone) {
      const phoneMatches = phones.some(p =>
        p.replace(/\D/g, '').includes(profile.contactInfo.primaryPhone!.replace(/\D/g, ''))
      );

      checks.push({
        checkType: 'phone_consistency',
        status: phoneMatches ? 'passed' : 'warning',
        score: phoneMatches ? 1 : 0.5,
        details: phoneMatches
          ? 'Phone numbers are consistent'
          : 'Phone numbers may differ across documents',
        sourceDocuments: documents.map(d => d.id),
        sourceFields: ['phone'],
        expectedValue: profile.contactInfo.primaryPhone,
        actualValue: phones.join(', '),
        discrepancy: phoneMatches ? null : 'Phone number variation detected',
      });
    }

    // Check email consistency
    if (emails.length > 0 && profile.contactInfo.email) {
      const emailMatches = emails.some(e =>
        e.toLowerCase() === profile.contactInfo.email!.toLowerCase()
      );

      checks.push({
        checkType: 'email_consistency',
        status: emailMatches ? 'passed' : 'warning',
        score: emailMatches ? 1 : 0.5,
        details: emailMatches
          ? 'Email addresses are consistent'
          : 'Email addresses may differ across documents',
        sourceDocuments: documents.map(d => d.id),
        sourceFields: ['email'],
        expectedValue: profile.contactInfo.email,
        actualValue: emails.join(', '),
        discrepancy: emailMatches ? null : 'Email variation detected',
      });
    }

    return checks;
  }

  // ============================================================================
  // Cross-Document Consistency
  // ============================================================================

  private async performCrossDocumentConsistency(
    documents: readonly DocumentUpload[]
  ): Promise<ValidationCheck[]> {
    const checks: ValidationCheck[] = [];

    // Check if all required document types are present
    const requiredTypes = ['national_id', 'lease_agreement'];
    const presentTypes = new Set(documents.map(d => d.documentType));

    for (const requiredType of requiredTypes) {
      const isPresent = presentTypes.has(requiredType as any);

      checks.push({
        checkType: 'document_authenticity',
        status: isPresent ? 'passed' : 'warning',
        score: isPresent ? 1 : 0.5,
        details: isPresent
          ? `${requiredType} document is present`
          : `${requiredType} document is missing`,
        sourceDocuments: [],
        sourceFields: [],
        expectedValue: requiredType,
        actualValue: isPresent ? 'Present' : 'Missing',
        discrepancy: isPresent ? null : `Missing ${requiredType}`,
      });
    }

    return checks;
  }

  // ============================================================================
  // External Verification
  // ============================================================================

  private async performExternalVerification(
    profile: TenantIdentityProfile
  ): Promise<ValidationCheck[]> {
    const checks: ValidationCheck[] = [];

    if (!this.externalProvider || profile.idNumbers.length === 0) {
      return checks;
    }

    for (const idNumber of profile.idNumbers) {
      try {
        const result = await this.externalProvider.verifyIdNumber({
          idType: idNumber.type,
          idNumber: idNumber.number,
          fullName: profile.fullName,
          dateOfBirth: profile.dateOfBirth ?? undefined,
          // Country comes from the ID record itself; falling back to a
          // hardcoded 'TZ' would cause verification to query the wrong
          // national registry. Empty string lets the provider reject.
          country: idNumber.issuingCountry ?? '',
        });

        checks.push({
          checkType: 'id_number_verification',
          status: result.verified ? 'passed' : 'failed',
          score: result.confidence,
          details: result.details,
          sourceDocuments: [],
          sourceFields: result.matchedFields,
          expectedValue: 'External verification match',
          actualValue: result.verified ? 'Verified' : 'Not verified',
          discrepancy: result.verified
            ? null
            : `Mismatched fields: ${result.mismatchedFields.join(', ')}`,
        });
      } catch (error) {
        logger.error('External verification failed', { error, idType: idNumber.type });

        checks.push({
          checkType: 'id_number_verification',
          status: 'skipped',
          score: 0,
          details: 'External verification service unavailable',
          sourceDocuments: [],
          sourceFields: [],
          expectedValue: null,
          actualValue: null,
          discrepancy: null,
        });
      }
    }

    return checks;
  }

  // ============================================================================
  // Status Calculation
  // ============================================================================

  private calculateOverallStatus(checks: readonly ValidationCheck[]): {
    overallStatus: ValidationStatus;
    overallScore: number;
    requiresManualReview: boolean;
  } {
    const activeChecks = checks.filter(c => c.status !== 'skipped');

    if (activeChecks.length === 0) {
      return {
        overallStatus: 'skipped',
        overallScore: 0,
        requiresManualReview: true,
      };
    }

    const passedCount = activeChecks.filter(c => c.status === 'passed').length;
    const failedCount = activeChecks.filter(c => c.status === 'failed').length;
    const warningCount = activeChecks.filter(c => c.status === 'warning').length;

    const avgScore = activeChecks.reduce((sum, c) => sum + c.score, 0) / activeChecks.length;

    let overallStatus: ValidationStatus;
    let requiresManualReview = false;

    if (failedCount > 0) {
      overallStatus = 'failed';
      requiresManualReview = true;
    } else if (warningCount > 0) {
      overallStatus = 'warning';
      requiresManualReview = warningCount > 2;
    } else if (avgScore >= this.config.autoApproveThreshold) {
      overallStatus = 'passed';
    } else {
      overallStatus = 'manual_review';
      requiresManualReview = true;
    }

    return {
      overallStatus,
      overallScore: Math.round(avgScore * 100) / 100,
      requiresManualReview,
    };
  }

  // ============================================================================
  // Summary Generation
  // ============================================================================

  private generateSummaryAndRecommendations(
    checks: readonly ValidationCheck[],
    overallStatus: ValidationStatus
  ): {
    summary: string;
    recommendations: readonly string[];
  } {
    const passedCount = checks.filter(c => c.status === 'passed').length;
    const failedCount = checks.filter(c => c.status === 'failed').length;
    const warningCount = checks.filter(c => c.status === 'warning').length;

    let summary: string;
    const recommendations: string[] = [];

    switch (overallStatus) {
      case 'passed':
        summary = `Validation completed successfully. ${passedCount}/${checks.length} checks passed.`;
        break;
      case 'warning':
        summary = `Validation completed with ${warningCount} warning(s). ${passedCount}/${checks.length} checks passed.`;
        break;
      case 'failed':
        summary = `Validation failed. ${failedCount} critical issue(s) detected.`;
        break;
      default:
        summary = `Validation requires manual review. ${passedCount}/${checks.length} checks passed.`;
    }

    // Generate recommendations based on failed/warning checks
    for (const check of checks) {
      if (check.status === 'failed') {
        switch (check.checkType) {
          case 'name_matching':
            recommendations.push('Verify customer name across all documents - significant mismatch detected');
            break;
          case 'id_number_verification':
            recommendations.push('Request valid ID document - current ID failed verification');
            break;
          case 'date_alignment':
            recommendations.push('Review document dates - inconsistent or invalid dates detected');
            break;
          default:
            recommendations.push(`Review ${check.checkType} - ${check.discrepancy ?? 'issue detected'}`);
        }
      } else if (check.status === 'warning') {
        switch (check.checkType) {
          case 'name_matching':
            recommendations.push('Confirm minor name variations are acceptable');
            break;
          case 'address_consistency':
            recommendations.push('Verify address variations are for the same location');
            break;
          default:
            recommendations.push(`Consider reviewing ${check.checkType}`);
        }
      }
    }

    // Remove duplicates
    const uniqueRecommendations = [...new Set(recommendations)];

    return {
      summary,
      recommendations: uniqueRecommendations,
    };
  }

  // ============================================================================
  // Manual Review Operations
  // ============================================================================

  async recordManualReview(params: {
    validationResultId: ValidationResultId;
    tenantId: TenantId;
    reviewedBy: UserId;
    notes: string;
    overrideStatus?: ValidationStatus;
  }): Promise<ServiceResult<ValidationResult>> {
    const { validationResultId, tenantId, reviewedBy, notes, overrideStatus } = params;

    const result = await this.validationRepository.findById(validationResultId, tenantId);
    if (!result) {
      return err('VALIDATION_NOT_FOUND', 'Validation result not found');
    }

    const now = new Date().toISOString();

    const updatedResult: ValidationResult = {
      ...result,
      overallStatus: overrideStatus ?? result.overallStatus,
      requiresManualReview: false,
      reviewedAt: now,
      reviewedBy,
      reviewNotes: notes,
    };

    const saved = await this.validationRepository.update(updatedResult);

    logger.info('Manual review recorded', {
      validationResultId,
      tenantId,
      reviewedBy,
      overrideStatus,
    });

    return ok(saved);
  }

  // ============================================================================
  // Query Operations
  // ============================================================================

  async getValidationResult(
    id: ValidationResultId,
    tenantId: TenantId
  ): Promise<ServiceResult<ValidationResult | null>> {
    const result = await this.validationRepository.findById(id, tenantId);
    return ok(result);
  }

  async getLatestValidation(
    customerId: CustomerId,
    tenantId: TenantId
  ): Promise<ServiceResult<ValidationResult | null>> {
    const result = await this.validationRepository.findLatestByCustomer(customerId, tenantId);
    return ok(result);
  }

  async getValidationHistory(
    customerId: CustomerId,
    tenantId: TenantId
  ): Promise<ServiceResult<readonly ValidationResult[]>> {
    const results = await this.validationRepository.findByCustomer(customerId, tenantId);
    return ok(results);
  }
}
