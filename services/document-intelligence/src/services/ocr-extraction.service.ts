/**
 * OCR & Data Extraction Service (Workflow G.2)
 * 
 * Integrates with AWS Textract or Google Vision to extract fields
 * into TenantIdentityProfile and create Verification Badges.
 */

import type {
  TenantId,
  UserId,
  CustomerId,
  DocumentId,
  IdentityProfileId,
  VerificationBadgeId,
  DocumentUpload,
  OCRExtractionResult,
  ExtractedField,
  TenantIdentityProfile,
  VerificationBadge,
  BadgeType,
  OCRProvider,
  OCRStatus,
  ServiceResult,
} from '../types/index.js';
import { ok, err } from '../types/index.js';
import { logger } from '../utils/logger.js';
import {
  generateIdentityProfileId,
  generateVerificationBadgeId,
  generateOCRExtractionId,
} from '../utils/id-generator.js';
import { normalizeName, extractNameParts } from '../utils/name-matcher.js';
import type { IDocumentRepository, IStorageProvider } from './document-collection.service.js';

// ============================================================================
// OCR Provider Interface
// ============================================================================

export interface IOCRProvider {
  readonly name: OCRProvider;
  
  extractText(
    buffer: Buffer,
    mimeType: string,
    options?: {
      language?: string;
      extractStructuredData?: boolean;
      documentType?: string;
    }
  ): Promise<{
    rawText: string;
    structuredData: Record<string, unknown> | null;
    fields: ExtractedField[];
    confidence: number;
    language: string;
    pageCount: number;
  }>;
}

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface IOCRExtractionRepository {
  create(extraction: OCRExtractionResult): Promise<OCRExtractionResult>;
  findById(id: string, tenantId: TenantId): Promise<OCRExtractionResult | null>;
  findByDocument(documentId: DocumentId, tenantId: TenantId): Promise<OCRExtractionResult | null>;
}

export interface IIdentityProfileRepository {
  create(profile: TenantIdentityProfile): Promise<TenantIdentityProfile>;
  findById(id: IdentityProfileId, tenantId: TenantId): Promise<TenantIdentityProfile | null>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId): Promise<TenantIdentityProfile | null>;
  update(profile: TenantIdentityProfile): Promise<TenantIdentityProfile>;
}

export interface IVerificationBadgeRepository {
  create(badge: VerificationBadge): Promise<VerificationBadge>;
  findById(id: VerificationBadgeId, tenantId: TenantId): Promise<VerificationBadge | null>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId): Promise<readonly VerificationBadge[]>;
  findByType(customerId: CustomerId, badgeType: BadgeType, tenantId: TenantId): Promise<VerificationBadge | null>;
  update(badge: VerificationBadge): Promise<VerificationBadge>;
}

// ============================================================================
// Field Extraction Mappings
// ============================================================================

const ID_DOCUMENT_FIELDS = [
  'full_name', 'first_name', 'last_name', 'middle_name',
  'date_of_birth', 'id_number', 'nationality', 'gender',
  'issue_date', 'expiry_date', 'place_of_birth', 'address',
];

const EMPLOYMENT_DOCUMENT_FIELDS = [
  'employee_name', 'employer_name', 'job_title', 'employment_type',
  'salary', 'start_date', 'end_date',
];

const ADDRESS_DOCUMENT_FIELDS = [
  'full_name', 'address_line1', 'address_line2', 'city',
  'region', 'postal_code', 'country',
];

// ============================================================================
// OCR Extraction Service
// ============================================================================

export interface OCRExtractionServiceOptions {
  readonly ocrProvider: IOCRProvider;
  readonly documentRepository: IDocumentRepository;
  readonly storageProvider: IStorageProvider;
  readonly extractionRepository: IOCRExtractionRepository;
  readonly identityProfileRepository: IIdentityProfileRepository;
  readonly verificationBadgeRepository: IVerificationBadgeRepository;
  readonly defaultLanguage?: string;
}

export class OCRExtractionService {
  private readonly ocrProvider: IOCRProvider;
  private readonly documentRepository: IDocumentRepository;
  private readonly storageProvider: IStorageProvider;
  private readonly extractionRepository: IOCRExtractionRepository;
  private readonly identityProfileRepository: IIdentityProfileRepository;
  private readonly badgeRepository: IVerificationBadgeRepository;
  private readonly defaultLanguage: string;

  constructor(options: OCRExtractionServiceOptions) {
    this.ocrProvider = options.ocrProvider;
    this.documentRepository = options.documentRepository;
    this.storageProvider = options.storageProvider;
    this.extractionRepository = options.extractionRepository;
    this.identityProfileRepository = options.identityProfileRepository;
    this.badgeRepository = options.verificationBadgeRepository;
    this.defaultLanguage = options.defaultLanguage ?? 'en';
  }

  // ============================================================================
  // Extract Text & Data from Document
  // ============================================================================

  async extractFromDocument(
    documentId: DocumentId,
    tenantId: TenantId,
    options?: {
      language?: string;
      forceReprocess?: boolean;
    }
  ): Promise<ServiceResult<OCRExtractionResult>> {
    const document = await this.documentRepository.findById(documentId, tenantId);
    if (!document) {
      return err('DOCUMENT_NOT_FOUND', 'Document not found');
    }

    // Check if already processed
    if (!options?.forceReprocess) {
      const existingExtraction = await this.extractionRepository.findByDocument(documentId, tenantId);
      if (existingExtraction && existingExtraction.status === 'completed') {
        return ok(existingExtraction);
      }
    }

    // Validate document type is extractable
    const extractableMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff', 'image/webp'];
    if (!extractableMimeTypes.includes(document.mimeType)) {
      return err(
        'UNSUPPORTED_TYPE',
        `Cannot extract text from ${document.mimeType}. Supported: ${extractableMimeTypes.join(', ')}`
      );
    }

    logger.info('Starting OCR extraction', {
      documentId,
      tenantId,
      documentType: document.documentType,
      mimeType: document.mimeType,
    });

    const startTime = Date.now();

    try {
      // Download document content
      const content = await this.storageProvider.download(tenantId, document.storageKey);

      // Perform OCR extraction
      const ocrResult = await this.ocrProvider.extractText(content, document.mimeType, {
        language: options?.language ?? this.defaultLanguage,
        extractStructuredData: true,
        documentType: document.documentType,
      });

      const processingTimeMs = Date.now() - startTime;

      // Create extraction result
      const extraction: OCRExtractionResult = {
        id: generateOCRExtractionId(),
        documentId,
        tenantId,
        provider: this.ocrProvider.name,
        status: 'completed',
        rawText: ocrResult.rawText,
        extractedFields: ocrResult.fields,
        structuredData: ocrResult.structuredData ?? {},
        confidence: ocrResult.confidence,
        language: ocrResult.language,
        pageCount: ocrResult.pageCount,
        processingTimeMs,
        error: null,
        processedAt: new Date().toISOString(),
      };

      const savedExtraction = await this.extractionRepository.create(extraction);

      // Update document status
      await this.documentRepository.update({
        ...document,
        status: 'ocr_completed',
        processedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      logger.info('OCR extraction completed', {
        documentId,
        tenantId,
        confidence: ocrResult.confidence,
        fieldsExtracted: ocrResult.fields.length,
        processingTimeMs,
      });

      return ok(savedExtraction);
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'OCR extraction failed';

      logger.error('OCR extraction failed', {
        documentId,
        tenantId,
        error: errorMessage,
        processingTimeMs,
      });

      // Create failed extraction record
      const failedExtraction: OCRExtractionResult = {
        id: generateOCRExtractionId(),
        documentId,
        tenantId,
        provider: this.ocrProvider.name,
        status: 'failed',
        rawText: null,
        extractedFields: [],
        structuredData: {},
        confidence: 0,
        language: null,
        pageCount: 0,
        processingTimeMs,
        error: errorMessage,
        processedAt: new Date().toISOString(),
      };

      await this.extractionRepository.create(failedExtraction);

      return err('OCR_FAILED', errorMessage);
    }
  }

  // ============================================================================
  // Build/Update Identity Profile from Extractions
  // ============================================================================

  async buildIdentityProfile(
    customerId: CustomerId,
    tenantId: TenantId,
    documentIds: readonly DocumentId[]
  ): Promise<ServiceResult<TenantIdentityProfile>> {
    const now = new Date().toISOString();

    // Get existing profile or create new
    let profile = await this.identityProfileRepository.findByCustomer(customerId, tenantId);
    const isNewProfile = !profile;

    if (!profile) {
      profile = this.createEmptyProfile(customerId, tenantId);
    }

    // Process each document's extraction
    for (const documentId of documentIds) {
      const document = await this.documentRepository.findById(documentId, tenantId);
      if (!document) continue;

      const extraction = await this.extractionRepository.findByDocument(documentId, tenantId);
      if (!extraction || extraction.status !== 'completed') continue;

      // Merge extracted data into profile
      profile = this.mergeExtractionIntoProfile(profile, document, extraction);
    }

    // Calculate completeness score
    const completenessScore = this.calculateCompletenessScore(profile);

    // Update profile
    const updatedProfile: TenantIdentityProfile = {
      ...profile,
      completenessScore,
      verificationStatus: completenessScore >= 80 ? 'complete' : completenessScore >= 50 ? 'partial' : 'pending',
      updatedAt: now,
    };

    const savedProfile = isNewProfile
      ? await this.identityProfileRepository.create(updatedProfile)
      : await this.identityProfileRepository.update(updatedProfile);

    logger.info('Identity profile updated', {
      customerId,
      tenantId,
      profileId: savedProfile.id,
      completenessScore,
      verificationStatus: savedProfile.verificationStatus,
    });

    return ok(savedProfile);
  }

  // ============================================================================
  // Create Verification Badges
  // ============================================================================

  async createVerificationBadge(params: {
    customerId: CustomerId;
    tenantId: TenantId;
    badgeType: BadgeType;
    evidenceDocumentIds: readonly DocumentId[];
    verificationMethod: string;
    awardedBy: UserId;
    expiresAt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ServiceResult<VerificationBadge>> {
    const {
      customerId,
      tenantId,
      badgeType,
      evidenceDocumentIds,
      verificationMethod,
      awardedBy,
      expiresAt,
      metadata,
    } = params;

    // Check if badge already exists and is active
    const existingBadge = await this.badgeRepository.findByType(customerId, badgeType, tenantId);
    if (existingBadge && existingBadge.isActive) {
      return err('BADGE_EXISTS', `Active ${badgeType} badge already exists for this customer`);
    }

    // Get identity profile if exists
    const identityProfile = await this.identityProfileRepository.findByCustomer(customerId, tenantId);

    const now = new Date().toISOString();

    const badge: VerificationBadge = {
      id: generateVerificationBadgeId(),
      tenantId,
      customerId,
      identityProfileId: identityProfile?.id ?? null,
      badgeType,
      isActive: true,
      awardedAt: now,
      awardedBy,
      expiresAt: expiresAt ?? null,
      revokedAt: null,
      revokedBy: null,
      revocationReason: null,
      evidenceDocuments: evidenceDocumentIds as DocumentId[],
      verificationMethod,
      metadata: metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };

    const savedBadge = await this.badgeRepository.create(badge);

    logger.info('Verification badge created', {
      badgeId: savedBadge.id,
      customerId,
      tenantId,
      badgeType,
      verificationMethod,
    });

    return ok(savedBadge);
  }

  async revokeBadge(
    badgeId: VerificationBadgeId,
    tenantId: TenantId,
    reason: string,
    revokedBy: UserId
  ): Promise<ServiceResult<VerificationBadge>> {
    const badge = await this.badgeRepository.findById(badgeId, tenantId);
    if (!badge) {
      return err('BADGE_NOT_FOUND', 'Verification badge not found');
    }

    if (!badge.isActive) {
      return err('BADGE_ALREADY_REVOKED', 'Badge is already revoked');
    }

    const now = new Date().toISOString();

    const updatedBadge: VerificationBadge = {
      ...badge,
      isActive: false,
      revokedAt: now,
      revokedBy,
      revocationReason: reason,
      updatedAt: now,
    };

    const savedBadge = await this.badgeRepository.update(updatedBadge);

    logger.info('Verification badge revoked', {
      badgeId,
      tenantId,
      reason,
      revokedBy,
    });

    return ok(savedBadge);
  }

  // ============================================================================
  // Get Customer Badges
  // ============================================================================

  async getCustomerBadges(
    customerId: CustomerId,
    tenantId: TenantId
  ): Promise<ServiceResult<readonly VerificationBadge[]>> {
    const badges = await this.badgeRepository.findByCustomer(customerId, tenantId);
    return ok(badges);
  }

  async getActiveBadges(
    customerId: CustomerId,
    tenantId: TenantId
  ): Promise<ServiceResult<readonly VerificationBadge[]>> {
    const badges = await this.badgeRepository.findByCustomer(customerId, tenantId);
    const activeBadges = badges.filter(b => b.isActive && (!b.expiresAt || new Date(b.expiresAt) > new Date()));
    return ok(activeBadges);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private createEmptyProfile(customerId: CustomerId, tenantId: TenantId): TenantIdentityProfile {
    const now = new Date().toISOString();
    return {
      id: generateIdentityProfileId(),
      tenantId,
      customerId,
      fullName: '',
      firstName: null,
      middleName: null,
      lastName: null,
      dateOfBirth: null,
      gender: null,
      nationality: null,
      idNumbers: [],
      addresses: [],
      contactInfo: {
        primaryPhone: null,
        secondaryPhone: null,
        email: null,
        whatsapp: null,
      },
      employment: null,
      photoUrl: null,
      signatureUrl: null,
      verificationStatus: 'pending',
      completenessScore: 0,
      lastVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private mergeExtractionIntoProfile(
    profile: TenantIdentityProfile,
    document: DocumentUpload,
    extraction: OCRExtractionResult
  ): TenantIdentityProfile {
    const fields = new Map(extraction.extractedFields.map(f => [f.fieldName, f]));

    let updatedProfile = { ...profile };

    // Extract based on document type
    switch (document.documentType) {
      case 'national_id':
      case 'passport':
      case 'drivers_license':
        updatedProfile = this.extractIdDocumentFields(updatedProfile, fields, document);
        break;
      case 'employment_letter':
      case 'payslip':
        updatedProfile = this.extractEmploymentFields(updatedProfile, fields);
        break;
      case 'utility_bill':
      case 'bank_statement':
        updatedProfile = this.extractAddressFields(updatedProfile, fields);
        break;
    }

    return updatedProfile;
  }

  private extractIdDocumentFields(
    profile: TenantIdentityProfile,
    fields: Map<string, ExtractedField>,
    document: DocumentUpload
  ): TenantIdentityProfile {
    const fullNameField = fields.get('full_name');
    const firstNameField = fields.get('first_name');
    const lastNameField = fields.get('last_name');
    const dobField = fields.get('date_of_birth');
    const idNumberField = fields.get('id_number');
    const nationalityField = fields.get('nationality');
    const genderField = fields.get('gender');
    const issueDateField = fields.get('issue_date');
    const expiryDateField = fields.get('expiry_date');

    let fullName = profile.fullName;
    let firstName = profile.firstName;
    let lastName = profile.lastName;

    if (fullNameField?.value && fullNameField.confidence > 0.7) {
      fullName = fullNameField.value;
      const parts = extractNameParts(fullName);
      firstName = parts.firstName;
      lastName = parts.lastName;
    } else if (firstNameField?.value && lastNameField?.value) {
      firstName = firstNameField.value;
      lastName = lastNameField.value;
      fullName = `${firstName} ${lastName}`;
    }

    // Add ID number if not already present
    const idNumbers = [...profile.idNumbers];
    if (idNumberField?.value && idNumberField.confidence > 0.8) {
      const existingId = idNumbers.find(
        id => id.type === document.documentType && id.number === idNumberField.value
      );
      if (!existingId) {
        idNumbers.push({
          type: document.documentType,
          number: idNumberField.value,
          issuedAt: issueDateField?.value ?? null,
          expiresAt: expiryDateField?.value ?? null,
          issuingCountry: nationalityField?.value ?? null,
          verified: false,
        });
      }
    }

    return {
      ...profile,
      fullName: fullName || profile.fullName,
      firstName: firstName || profile.firstName,
      lastName: lastName || profile.lastName,
      dateOfBirth: dobField?.value || profile.dateOfBirth,
      nationality: nationalityField?.value || profile.nationality,
      gender: (genderField?.value?.toLowerCase() as 'male' | 'female' | 'other') || profile.gender,
      idNumbers,
    };
  }

  private extractEmploymentFields(
    profile: TenantIdentityProfile,
    fields: Map<string, ExtractedField>
  ): TenantIdentityProfile {
    const employerField = fields.get('employer_name');
    const jobTitleField = fields.get('job_title');
    const salaryField = fields.get('salary');

    if (!employerField?.value) return profile;

    return {
      ...profile,
      employment: {
        employer: employerField.value,
        jobTitle: jobTitleField?.value ?? null,
        employmentType: null,
        // Bug fix A-BUG-DEEP #6: locale-aware money parser. The previous
        // `parseFloat(x.replace(/[^0-9.]/g, ''))` silently corrupted any
        // European/African format that uses `,` as decimal separator
        // (e.g. "1.234,56" → "1.23456" → 1.23456). Use a robust parser
        // that detects which separator is the decimal mark (always the
        // last non-digit before the cents) and returns null on NaN /
        // implausible-range inputs.
        monthlyIncome: parseMonthlyIncome(salaryField?.value),
        // Currency is unknown from the OCR text alone. The caller
        // resolves it from the tenant's region-config after extraction
        // and overwrites this field. No hardcoded TZS default.
        incomeCurrency: null,
        verified: false,
      },
    };
  }

  private extractAddressFields(
    profile: TenantIdentityProfile,
    fields: Map<string, ExtractedField>
  ): TenantIdentityProfile {
    const addressLine1Field = fields.get('address_line1');
    const cityField = fields.get('city');

    if (!addressLine1Field?.value || !cityField?.value) return profile;

    const addresses = [...profile.addresses];
    const addressLine2Field = fields.get('address_line2');
    const regionField = fields.get('region');
    const postalCodeField = fields.get('postal_code');
    const countryField = fields.get('country');

    // Check if address already exists
    const existingAddress = addresses.find(
      a => a.line1 === addressLine1Field.value && a.city === cityField.value
    );

    if (!existingAddress) {
      addresses.push({
        type: 'current',
        line1: addressLine1Field.value,
        line2: addressLine2Field?.value ?? null,
        city: cityField.value,
        region: regionField?.value ?? null,
        postalCode: postalCodeField?.value ?? null,
        country: countryField?.value ?? 'Tanzania',
        verified: false,
      });
    }

    return {
      ...profile,
      addresses,
    };
  }

  private calculateCompletenessScore(profile: TenantIdentityProfile): number {
    const weights = {
      fullName: 20,
      dateOfBirth: 10,
      idNumbers: 25,
      addresses: 15,
      contactInfo: 15,
      employment: 10,
      photoUrl: 5,
    };

    let score = 0;

    if (profile.fullName) score += weights.fullName;
    if (profile.dateOfBirth) score += weights.dateOfBirth;
    if (profile.idNumbers.length > 0) score += weights.idNumbers;
    if (profile.addresses.length > 0) score += weights.addresses;
    if (profile.contactInfo.primaryPhone || profile.contactInfo.email) score += weights.contactInfo;
    if (profile.employment?.employer) score += weights.employment;
    if (profile.photoUrl) score += weights.photoUrl;

    return score;
  }
}

// ============================================================================
// Mock OCR Provider (for testing)
// ============================================================================

export class MockOCRProvider implements IOCRProvider {
  readonly name: OCRProvider = 'mock';

  async extractText(
    buffer: Buffer,
    mimeType: string,
    options?: {
      language?: string;
      extractStructuredData?: boolean;
      documentType?: string;
    }
  ): Promise<{
    rawText: string;
    structuredData: Record<string, unknown> | null;
    fields: ExtractedField[];
    confidence: number;
    language: string;
    pageCount: number;
  }> {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 500));

    const mockFields: ExtractedField[] = [
      {
        fieldName: 'full_name',
        value: 'George Mwikila',
        confidence: 0.95,
        boundingBox: { left: 100, top: 50, width: 200, height: 30 },
        normalized: true,
        validationStatus: 'valid',
      },
      {
        fieldName: 'id_number',
        value: '19850123456789012345',
        confidence: 0.92,
        boundingBox: { left: 100, top: 100, width: 200, height: 30 },
        normalized: true,
        validationStatus: 'valid',
      },
      {
        fieldName: 'date_of_birth',
        value: '1985-01-23',
        confidence: 0.88,
        boundingBox: { left: 100, top: 150, width: 150, height: 30 },
        normalized: true,
        validationStatus: 'valid',
      },
      {
        fieldName: 'nationality',
        value: 'Tanzanian',
        confidence: 0.90,
        boundingBox: { left: 100, top: 200, width: 150, height: 30 },
        normalized: true,
        validationStatus: 'valid',
      },
    ];

    return {
      rawText: 'National Identification Authority\nUnited Republic of Tanzania\nGeorge Mwikila\nID: 19850123456789012345\nDOB: 23/01/1985\nNationality: Tanzanian',
      structuredData: {
        documentType: options?.documentType ?? 'national_id',
        country: 'TZ',
      },
      fields: mockFields,
      confidence: 0.91,
      language: options?.language ?? 'en',
      pageCount: 1,
    };
  }
}

// ============================================================================
// Locale-aware money parser (A-BUG-DEEP #6)
// ============================================================================

const MIN_PLAUSIBLE_MONTHLY_INCOME = 100;
const MAX_PLAUSIBLE_MONTHLY_INCOME = 10_000_000;

/**
 * Parse a raw OCR salary string ("KES 1,234,567.50", "TZS 1.234.567,50",
 * "$ 5 000.00") into a Number in major units. Returns `null` if the
 * input is empty, fails to parse, or is outside a plausible monthly-
 * income range.
 *
 * Detection rule: when both `.` and `,` appear, whichever comes LAST in
 * the string is the decimal mark — the other is the thousands separator.
 * When only one separator appears, treat trailing-2-digit groups as
 * decimal (e.g. "1234,56" → 1234.56) and longer groups as thousands
 * ("1,234" → 1234).
 */
export function parseMonthlyIncome(raw: string | null | undefined): number | null {
  if (!raw || typeof raw !== 'string') return null;
  // Strip currency markers and whitespace, keep digits + . , and minus.
  const cleaned = raw.replace(/[^0-9.,-]/g, '').trim();
  if (!cleaned) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');

  let normalised: string;
  if (lastDot === -1 && lastComma === -1) {
    normalised = cleaned;
  } else if (lastDot !== -1 && lastComma !== -1) {
    // Both present — the later one is the decimal mark.
    const decimalMark = lastDot > lastComma ? '.' : ',';
    const thousandsMark = decimalMark === '.' ? ',' : '.';
    normalised = cleaned
      .split(thousandsMark).join('')
      .replace(decimalMark, '.');
  } else {
    // Only one separator. Decide thousands vs decimal by group length.
    const sep = lastDot !== -1 ? '.' : ',';
    const tail = cleaned.slice(cleaned.lastIndexOf(sep) + 1);
    if (tail.length === 3 && cleaned.split(sep).every((g, i) => i === 0 ? g.length > 0 : g.length === 3)) {
      // Thousands separator (e.g. "1,234,567").
      normalised = cleaned.split(sep).join('');
    } else {
      // Decimal separator.
      normalised = cleaned.replace(sep, '.');
    }
  }

  const value = Number(normalised);
  if (!Number.isFinite(value)) return null;
  if (value < MIN_PLAUSIBLE_MONTHLY_INCOME || value > MAX_PLAUSIBLE_MONTHLY_INCOME) {
    return null;
  }
  return value;
}
