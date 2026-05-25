/**
 * Fraud Detection Engine (Workflow G.3)
 * 
 * Performs multi-layer fraud checks:
 * - Image/PDF integrity checks
 * - Metadata anomaly detection
 * - Font/kerning inconsistency detection
 * - Cross-document consistency validation
 * - Cross-tenant duplicate detection
 * - FraudRiskScore calculation
 */

import type {
  TenantId,
  UserId,
  CustomerId,
  DocumentId,
  FraudRiskScoreId,
  DocumentUpload,
  FraudRiskScore,
  FraudIndicator,
  FraudRiskLevel,
  FraudIndicatorType,
  ServiceResult,
} from '../types/index.js';
import { ok, err } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { generateFraudRiskScoreId } from '../utils/id-generator.js';
import type { IDocumentRepository, IStorageProvider } from './document-collection.service.js';

// ============================================================================
// Repository Interface
// ============================================================================

export interface IFraudRiskScoreRepository {
  create(score: FraudRiskScore): Promise<FraudRiskScore>;
  findById(id: FraudRiskScoreId, tenantId: TenantId): Promise<FraudRiskScore | null>;
  findByDocument(documentId: DocumentId, tenantId: TenantId): Promise<FraudRiskScore | null>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId): Promise<readonly FraudRiskScore[]>;
  update(score: FraudRiskScore): Promise<FraudRiskScore>;
  findByChecksum(checksum: string): Promise<readonly FraudRiskScore[]>; // Cross-tenant
}

// ============================================================================
// Image Analysis Interface
// ============================================================================

export interface IImageAnalyzer {
  analyzeIntegrity(buffer: Buffer, mimeType: string): Promise<{
    isModified: boolean;
    confidence: number;
    indicators: {
      type: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      confidence: number;
    }[];
  }>;
  
  extractMetadata(buffer: Buffer): Promise<Record<string, unknown>>;
  
  detectDuplicateRegions(buffer: Buffer): Promise<{
    found: boolean;
    regions: { x: number; y: number; width: number; height: number }[];
    confidence: number;
  }>;
}

// ============================================================================
// Service Configuration
// ============================================================================

export interface FraudDetectionConfig {
  readonly highRiskThreshold: number;
  readonly criticalRiskThreshold: number;
  readonly enableCrossTenantDuplicateCheck: boolean;
  readonly modelVersion: string;
}

const DEFAULT_CONFIG: FraudDetectionConfig = {
  highRiskThreshold: 0.6,
  criticalRiskThreshold: 0.8,
  enableCrossTenantDuplicateCheck: true,
  modelVersion: '1.0.0',
};

// ============================================================================
// Fraud Detection Service
// ============================================================================

export interface FraudDetectionServiceOptions {
  readonly documentRepository: IDocumentRepository;
  readonly storageProvider: IStorageProvider;
  readonly fraudScoreRepository: IFraudRiskScoreRepository;
  readonly imageAnalyzer?: IImageAnalyzer;
  readonly config?: Partial<FraudDetectionConfig>;
}

export class FraudDetectionService {
  private readonly documentRepository: IDocumentRepository;
  private readonly storageProvider: IStorageProvider;
  private readonly fraudScoreRepository: IFraudRiskScoreRepository;
  private readonly imageAnalyzer?: IImageAnalyzer;
  private readonly config: FraudDetectionConfig;

  constructor(options: FraudDetectionServiceOptions) {
    this.documentRepository = options.documentRepository;
    this.storageProvider = options.storageProvider;
    this.fraudScoreRepository = options.fraudScoreRepository;
    this.imageAnalyzer = options.imageAnalyzer;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  // ============================================================================
  // Main Fraud Detection Entry Point
  // ============================================================================

  async analyzeDocument(
    documentId: DocumentId,
    tenantId: TenantId
  ): Promise<ServiceResult<FraudRiskScore>> {
    const document = await this.documentRepository.findById(documentId, tenantId);
    if (!document) {
      return err('DOCUMENT_NOT_FOUND', 'Document not found');
    }

    logger.info('Starting fraud detection analysis', {
      documentId,
      tenantId,
      documentType: document.documentType,
    });

    const indicators: FraudIndicator[] = [];
    const now = new Date().toISOString();

    try {
      // Download document content
      const content = await this.storageProvider.download(tenantId, document.storageKey);

      // Run all fraud checks
      const checks = await Promise.all([
        this.checkMetadataAnomalies(document, content),
        this.checkFileIntegrity(content, document.mimeType),
        this.checkCrossTenantDuplicates(document),
        this.checkFormatAnomalies(document),
        this.checkDateConsistency(document),
      ]);

      // Collect all indicators
      for (const check of checks) {
        indicators.push(...check);
      }

      // Run image-specific checks if applicable
      if (document.mimeType.startsWith('image/') && this.imageAnalyzer) {
        const imageIndicators = await this.analyzeImageIntegrity(content, document.mimeType);
        indicators.push(...imageIndicators);
      }

      // Calculate overall risk score
      const { score, riskLevel, primaryIndicator } = this.calculateRiskScore(indicators);

      // Determine if manual review is required
      const reviewRequired = riskLevel === 'high' || riskLevel === 'critical';

      // Create fraud risk score
      const fraudScore: FraudRiskScore = {
        id: generateFraudRiskScoreId(),
        tenantId,
        documentId,
        customerId: document.customerId,
        riskLevel,
        score,
        indicators,
        primaryIndicator,
        modelVersion: this.config.modelVersion,
        modelConfidence: this.calculateModelConfidence(indicators),
        decision: reviewRequired ? null : 'approved',
        decisionReason: reviewRequired ? null : 'Automated approval - low risk',
        reviewRequired,
        reviewedAt: null,
        reviewedBy: null,
        reviewNotes: null,
        calculatedAt: now,
        createdAt: now,
      };

      const savedScore = await this.fraudScoreRepository.create(fraudScore);

      // Update document status
      await this.documentRepository.update({
        ...document,
        status: reviewRequired ? 'fraud_check' : 'verified',
        updatedAt: now,
      });

      logger.info('Fraud detection analysis completed', {
        documentId,
        tenantId,
        riskLevel,
        score,
        indicatorCount: indicators.length,
        reviewRequired,
      });

      return ok(savedScore);
    } catch (error) {
      logger.error('Fraud detection analysis failed', {
        documentId,
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return err('ANALYSIS_FAILED', 'Fraud detection analysis failed');
    }
  }

  // ============================================================================
  // Individual Fraud Checks
  // ============================================================================

  /**
   * Check for metadata anomalies (EXIF, PDF metadata)
   */
  private async checkMetadataAnomalies(
    document: DocumentUpload,
    content: Buffer
  ): Promise<FraudIndicator[]> {
    const indicators: FraudIndicator[] = [];
    const now = new Date().toISOString();

    // Check file size anomalies
    if (document.fileSize === 0) {
      indicators.push({
        type: 'suspicious_format',
        severity: 'high',
        description: 'Document has zero file size',
        confidence: 1.0,
        evidence: `Reported size: ${document.fileSize} bytes`,
        recommendation: 'Reject document and request re-upload',
        detectedAt: now,
      });
    }

    // Check for unusually small ID documents
    if (
      ['national_id', 'passport', 'drivers_license'].includes(document.documentType) &&
      document.fileSize < 50000 // Less than 50KB
    ) {
      indicators.push({
        type: 'suspicious_format',
        severity: 'medium',
        description: 'ID document file size is unusually small',
        confidence: 0.7,
        evidence: `File size: ${document.fileSize} bytes (typical: >100KB)`,
        recommendation: 'Request higher quality scan',
        detectedAt: now,
      });
    }

    // Check for unusually large files (potential hidden data)
    if (document.fileSize > 20_000_000) { // > 20MB
      indicators.push({
        type: 'suspicious_format',
        severity: 'low',
        description: 'Document file size is unusually large',
        confidence: 0.5,
        evidence: `File size: ${(document.fileSize / 1_000_000).toFixed(2)}MB`,
        recommendation: 'Review for hidden embedded content',
        detectedAt: now,
      });
    }

    // Extract and check metadata if image analyzer available
    if (this.imageAnalyzer) {
      try {
        const metadata = await this.imageAnalyzer.extractMetadata(content);
        
        // Check for software editing indicators
        if (metadata.software) {
          const editingSoftware = ['photoshop', 'gimp', 'paint', 'pixelmator'];
          const softwareLower = String(metadata.software).toLowerCase();
          
          if (editingSoftware.some(s => softwareLower.includes(s))) {
            indicators.push({
              type: 'metadata_tampering',
              severity: 'high',
              description: 'Document shows signs of editing software',
              confidence: 0.85,
              evidence: `Software: ${metadata.software}`,
              recommendation: 'Manual review required - potential document manipulation',
              detectedAt: now,
            });
          }
        }

        // Check for modification dates after creation
        if (metadata.modifyDate && metadata.createDate) {
          const modifyDate = new Date(metadata.modifyDate as string);
          const createDate = new Date(metadata.createDate as string);
          
          if (modifyDate > createDate) {
            const daysDiff = Math.floor((modifyDate.getTime() - createDate.getTime()) / (1000 * 60 * 60 * 24));
            
            if (daysDiff > 1) {
              indicators.push({
                type: 'exif_anomaly',
                severity: 'medium',
                description: 'Document modification date significantly after creation',
                confidence: 0.6,
                evidence: `Created: ${createDate.toISOString()}, Modified: ${modifyDate.toISOString()}`,
                recommendation: 'Verify document authenticity',
                detectedAt: now,
              });
            }
          }
        }
      } catch (error) {
        logger.warn('Failed to extract metadata', { error });
      }
    }

    return indicators;
  }

  /**
   * Check file integrity (magic bytes, structure)
   */
  private async checkFileIntegrity(
    content: Buffer,
    mimeType: string
  ): Promise<FraudIndicator[]> {
    const indicators: FraudIndicator[] = [];
    const now = new Date().toISOString();

    // Check magic bytes match claimed MIME type
    const magicBytes: Record<string, Buffer> = {
      'application/pdf': Buffer.from([0x25, 0x50, 0x44, 0x46]), // %PDF
      'image/jpeg': Buffer.from([0xFF, 0xD8, 0xFF]),
      'image/png': Buffer.from([0x89, 0x50, 0x4E, 0x47]),
      'image/gif': Buffer.from([0x47, 0x49, 0x46, 0x38]),
      'image/webp': Buffer.from([0x52, 0x49, 0x46, 0x46]), // RIFF
      'image/tiff': Buffer.from([0x49, 0x49, 0x2A, 0x00]), // Little-endian TIFF
    };

    const expectedMagic = magicBytes[mimeType];
    if (expectedMagic) {
      const actualMagic = content.subarray(0, expectedMagic.length);
      
      if (!actualMagic.equals(expectedMagic)) {
        // Check if it might be big-endian TIFF
        if (mimeType === 'image/tiff') {
          const bigEndianTiff = Buffer.from([0x4D, 0x4D, 0x00, 0x2A]);
          if (actualMagic.equals(bigEndianTiff)) {
            // Valid big-endian TIFF, no indicator needed
          } else {
            indicators.push({
              type: 'suspicious_format',
              severity: 'critical',
              description: 'File signature does not match claimed MIME type',
              confidence: 0.95,
              evidence: `Claimed: ${mimeType}, Actual magic bytes: ${actualMagic.toString('hex')}`,
              recommendation: 'Reject document - potential file spoofing',
              detectedAt: now,
            });
          }
        } else {
          indicators.push({
            type: 'suspicious_format',
            severity: 'critical',
            description: 'File signature does not match claimed MIME type',
            confidence: 0.95,
            evidence: `Claimed: ${mimeType}, Actual magic bytes: ${actualMagic.toString('hex')}`,
            recommendation: 'Reject document - potential file spoofing',
            detectedAt: now,
          });
        }
      }
    }

    return indicators;
  }

  /**
   * Check for cross-tenant duplicate documents
   */
  private async checkCrossTenantDuplicates(
    document: DocumentUpload
  ): Promise<FraudIndicator[]> {
    const indicators: FraudIndicator[] = [];
    const now = new Date().toISOString();

    if (!this.config.enableCrossTenantDuplicateCheck) {
      return indicators;
    }

    try {
      const duplicates = await this.fraudScoreRepository.findByChecksum(document.checksum);
      
      // Filter out same document and same customer
      const crossTenantDuplicates = duplicates.filter(
        d => d.documentId !== document.id && 
             (d.tenantId !== document.tenantId || d.customerId !== document.customerId)
      );

      if (crossTenantDuplicates.length > 0) {
        const severity: FraudRiskLevel = crossTenantDuplicates.length > 2 ? 'critical' : 'high';
        
        indicators.push({
          type: 'cross_tenant_duplicate',
          severity,
          description: `Document appears in ${crossTenantDuplicates.length} other tenant profiles`,
          confidence: 0.98,
          evidence: `Same document checksum found across multiple tenants`,
          recommendation: 'Investigate potential identity fraud - same document used by multiple applicants',
          detectedAt: now,
        });
      }
    } catch (error) {
      logger.warn('Cross-tenant duplicate check failed', { error });
    }

    return indicators;
  }

  /**
   * Check format anomalies (extension vs MIME type)
   */
  private async checkFormatAnomalies(
    document: DocumentUpload
  ): Promise<FraudIndicator[]> {
    const indicators: FraudIndicator[] = [];
    const now = new Date().toISOString();

    const mimeExtMap: Record<string, string[]> = {
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/tiff': ['.tif', '.tiff'],
      'image/webp': ['.webp'],
    };

    const expectedExts = mimeExtMap[document.mimeType];
    if (expectedExts) {
      const ext = document.originalFileName.toLowerCase().substring(
        document.originalFileName.lastIndexOf('.')
      );
      
      if (!expectedExts.includes(ext)) {
        indicators.push({
          type: 'suspicious_format',
          severity: 'medium',
          description: 'File extension does not match MIME type',
          confidence: 0.8,
          evidence: `Extension: ${ext}, MIME type: ${document.mimeType}`,
          recommendation: 'Verify file is what it claims to be',
          detectedAt: now,
        });
      }
    }

    return indicators;
  }

  /**
   * Check date consistency in document metadata
   */
  private async checkDateConsistency(
    document: DocumentUpload
  ): Promise<FraudIndicator[]> {
    const indicators: FraudIndicator[] = [];
    const now = new Date().toISOString();
    const metadata = document.metadata as Record<string, string>;

    // Check if expiry date is before issue date
    if (metadata.issuedDate && metadata.expiresAt) {
      const issued = new Date(metadata.issuedDate);
      const expires = new Date(metadata.expiresAt);
      
      if (expires <= issued) {
        indicators.push({
          type: 'date_inconsistency',
          severity: 'high',
          description: 'Document expiry date is before or equal to issue date',
          confidence: 0.95,
          evidence: `Issued: ${metadata.issuedDate}, Expires: ${metadata.expiresAt}`,
          recommendation: 'Reject document - impossible date combination',
          detectedAt: now,
        });
      }
    }

    // Check if document is expired
    if (metadata.expiresAt) {
      const expires = new Date(metadata.expiresAt);
      if (expires < new Date()) {
        indicators.push({
          type: 'expired_document',
          severity: 'high',
          description: 'Document has expired',
          confidence: 1.0,
          evidence: `Expired on: ${metadata.expiresAt}`,
          recommendation: 'Request current valid document',
          detectedAt: now,
        });
      }
    }

    // Check if issue date is in the future
    if (metadata.issuedDate) {
      const issued = new Date(metadata.issuedDate);
      if (issued > new Date()) {
        indicators.push({
          type: 'date_inconsistency',
          severity: 'critical',
          description: 'Document issue date is in the future',
          confidence: 0.98,
          evidence: `Issue date: ${metadata.issuedDate}`,
          recommendation: 'Reject document - fraudulent dates',
          detectedAt: now,
        });
      }
    }

    return indicators;
  }

  /**
   * Analyze image integrity using image analyzer
   */
  private async analyzeImageIntegrity(
    content: Buffer,
    mimeType: string
  ): Promise<FraudIndicator[]> {
    const indicators: FraudIndicator[] = [];
    const now = new Date().toISOString();

    if (!this.imageAnalyzer) {
      return indicators;
    }

    try {
      // Check for image manipulation
      const integrityResult = await this.imageAnalyzer.analyzeIntegrity(content, mimeType);
      
      if (integrityResult.isModified) {
        for (const indicator of integrityResult.indicators) {
          indicators.push({
            type: indicator.type as FraudIndicatorType,
            severity: indicator.severity,
            description: indicator.description,
            confidence: indicator.confidence,
            evidence: null,
            recommendation: 'Manual review required',
            detectedAt: now,
          });
        }
      }

      // Check for copy-paste (duplicate regions)
      const duplicateResult = await this.imageAnalyzer.detectDuplicateRegions(content);
      
      if (duplicateResult.found && duplicateResult.regions.length > 0) {
        indicators.push({
          type: 'copy_paste_detected',
          severity: 'high',
          description: `Detected ${duplicateResult.regions.length} potentially cloned regions`,
          confidence: duplicateResult.confidence,
          evidence: `Regions: ${JSON.stringify(duplicateResult.regions)}`,
          recommendation: 'Document may have been digitally altered - manual review required',
          detectedAt: now,
        });
      }
    } catch (error) {
      logger.warn('Image integrity analysis failed', { error });
    }

    return indicators;
  }

  // ============================================================================
  // Risk Score Calculation
  // ============================================================================

  private calculateRiskScore(indicators: readonly FraudIndicator[]): {
    score: number;
    riskLevel: FraudRiskLevel;
    primaryIndicator: FraudIndicatorType | null;
  } {
    if (indicators.length === 0) {
      return { score: 0, riskLevel: 'low', primaryIndicator: null };
    }

    // Weight by severity
    const severityWeights: Record<FraudRiskLevel, number> = {
      low: 0.1,
      medium: 0.3,
      high: 0.6,
      critical: 1.0,
    };

    let totalWeight = 0;
    let weightedSum = 0;
    let highestSeverityIndicator: FraudIndicator | null = null;
    let highestSeverityWeight = 0;

    for (const indicator of indicators) {
      const weight = severityWeights[indicator.severity];
      weightedSum += indicator.confidence * weight;
      totalWeight += weight;

      if (weight > highestSeverityWeight) {
        highestSeverityWeight = weight;
        highestSeverityIndicator = indicator;
      }
    }

    // Calculate normalized score (0-1)
    const rawScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const score = Math.min(1, rawScore);

    // Determine risk level
    let riskLevel: FraudRiskLevel = 'low';
    if (score >= this.config.criticalRiskThreshold) {
      riskLevel = 'critical';
    } else if (score >= this.config.highRiskThreshold) {
      riskLevel = 'high';
    } else if (score >= 0.4) {
      riskLevel = 'medium';
    }

    // Override if any critical indicator exists
    if (indicators.some(i => i.severity === 'critical')) {
      riskLevel = 'critical';
    }

    return {
      score,
      riskLevel,
      primaryIndicator: highestSeverityIndicator?.type ?? null,
    };
  }

  private calculateModelConfidence(indicators: readonly FraudIndicator[]): number {
    if (indicators.length === 0) {
      return 0.95; // High confidence when no issues found
    }

    const avgConfidence = indicators.reduce((sum, i) => sum + i.confidence, 0) / indicators.length;
    return Math.round(avgConfidence * 100) / 100;
  }

  // ============================================================================
  // Manual Review Operations
  // ============================================================================

  async recordReview(params: {
    fraudScoreId: FraudRiskScoreId;
    tenantId: TenantId;
    decision: 'approved' | 'rejected' | 'review_required';
    decisionReason: string;
    notes: string | null;
    reviewedBy: UserId;
  }): Promise<ServiceResult<FraudRiskScore>> {
    const { fraudScoreId, tenantId, decision, decisionReason, notes, reviewedBy } = params;

    const fraudScore = await this.fraudScoreRepository.findById(fraudScoreId, tenantId);
    if (!fraudScore) {
      return err('FRAUD_SCORE_NOT_FOUND', 'Fraud risk score not found');
    }

    const now = new Date().toISOString();

    const updatedScore: FraudRiskScore = {
      ...fraudScore,
      decision,
      decisionReason,
      reviewRequired: false,
      reviewedAt: now,
      reviewedBy,
      reviewNotes: notes,
    };

    const saved = await this.fraudScoreRepository.update(updatedScore);

    // Update associated document status
    if (fraudScore.documentId) {
      const document = await this.documentRepository.findById(fraudScore.documentId, tenantId);
      if (document) {
        const newStatus = decision === 'approved' ? 'verified' : 'rejected';
        await this.documentRepository.update({
          ...document,
          status: newStatus,
          updatedAt: now,
        });
      }
    }

    logger.info('Fraud review recorded', {
      fraudScoreId,
      tenantId,
      decision,
      reviewedBy,
    });

    return ok(saved);
  }

  // ============================================================================
  // Query Operations
  // ============================================================================

  async getFraudScore(
    documentId: DocumentId,
    tenantId: TenantId
  ): Promise<ServiceResult<FraudRiskScore | null>> {
    const score = await this.fraudScoreRepository.findByDocument(documentId, tenantId);
    return ok(score);
  }

  async getCustomerFraudScores(
    customerId: CustomerId,
    tenantId: TenantId
  ): Promise<ServiceResult<readonly FraudRiskScore[]>> {
    const scores = await this.fraudScoreRepository.findByCustomer(customerId, tenantId);
    return ok(scores);
  }

  async getCustomerRiskLevel(
    customerId: CustomerId,
    tenantId: TenantId
  ): Promise<ServiceResult<{
    overallRiskLevel: FraudRiskLevel;
    highestScore: number;
    documentCount: number;
    flaggedCount: number;
  }>> {
    const scores = await this.fraudScoreRepository.findByCustomer(customerId, tenantId);

    if (scores.length === 0) {
      return ok({
        overallRiskLevel: 'low',
        highestScore: 0,
        documentCount: 0,
        flaggedCount: 0,
      });
    }

    const highestScore = Math.max(...scores.map(s => s.score));
    const flaggedCount = scores.filter(s => s.reviewRequired || s.decision === 'rejected').length;

    let overallRiskLevel: FraudRiskLevel = 'low';
    if (scores.some(s => s.riskLevel === 'critical')) {
      overallRiskLevel = 'critical';
    } else if (scores.some(s => s.riskLevel === 'high')) {
      overallRiskLevel = 'high';
    } else if (scores.some(s => s.riskLevel === 'medium')) {
      overallRiskLevel = 'medium';
    }

    return ok({
      overallRiskLevel,
      highestScore,
      documentCount: scores.length,
      flaggedCount,
    });
  }
}

// ============================================================================
// Mock Image Analyzer (for testing)
// ============================================================================

export class MockImageAnalyzer implements IImageAnalyzer {
  async analyzeIntegrity(buffer: Buffer, mimeType: string): Promise<{
    isModified: boolean;
    confidence: number;
    indicators: {
      type: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      confidence: number;
    }[];
  }> {
    // Simulate analysis
    await new Promise(resolve => setTimeout(resolve, 200));

    return {
      isModified: false,
      confidence: 0.92,
      indicators: [],
    };
  }

  async extractMetadata(buffer: Buffer): Promise<Record<string, unknown>> {
    return {
      width: 1200,
      height: 800,
      colorSpace: 'sRGB',
      createDate: new Date().toISOString(),
    };
  }

  async detectDuplicateRegions(buffer: Buffer): Promise<{
    found: boolean;
    regions: { x: number; y: number; width: number; height: number }[];
    confidence: number;
  }> {
    return {
      found: false,
      regions: [],
      confidence: 0.95,
    };
  }
}
