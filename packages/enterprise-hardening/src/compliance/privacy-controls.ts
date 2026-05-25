/**
 * Privacy Controls - GDPR & CCPA Compliance
 * 
 * Implements privacy-by-design principles and data subject rights management
 * for multi-tenant property management SaaS.
 */

import { z } from 'zod';

/**
 * Privacy Regulation Types
 */
export const PrivacyRegulation = {
  GDPR: 'GDPR',           // EU General Data Protection Regulation
  CCPA: 'CCPA',           // California Consumer Privacy Act
  CPRA: 'CPRA',           // California Privacy Rights Act (CCPA amendment)
  LGPD: 'LGPD',           // Brazil Lei Geral de Proteção de Dados
  POPIA: 'POPIA',         // South Africa Protection of Personal Information Act
  PDPA: 'PDPA',           // Various Asia-Pacific data protection acts
} as const;

export type PrivacyRegulation = typeof PrivacyRegulation[keyof typeof PrivacyRegulation];

/**
 * Data Subject Request Types (DSR)
 */
export const DSRType = {
  ACCESS: 'ACCESS',                   // Right to access personal data
  RECTIFICATION: 'RECTIFICATION',     // Right to correct inaccurate data
  ERASURE: 'ERASURE',                 // Right to be forgotten
  PORTABILITY: 'PORTABILITY',         // Right to data portability
  RESTRICTION: 'RESTRICTION',         // Right to restrict processing
  OBJECTION: 'OBJECTION',             // Right to object to processing
  OPT_OUT_SALE: 'OPT_OUT_SALE',       // CCPA: Do not sell my info
  AUTOMATED_DECISION: 'AUTOMATED_DECISION', // Right related to automated decision-making
} as const;

export type DSRType = typeof DSRType[keyof typeof DSRType];

/**
 * DSR Request Status
 */
export const DSRStatus = {
  PENDING: 'PENDING',
  IDENTITY_VERIFICATION: 'IDENTITY_VERIFICATION',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
  PARTIALLY_COMPLETED: 'PARTIALLY_COMPLETED',
} as const;

export type DSRStatus = typeof DSRStatus[keyof typeof DSRStatus];

/**
 * Legal Basis for Processing (GDPR Article 6)
 */
export const LegalBasis = {
  CONSENT: 'CONSENT',
  CONTRACT: 'CONTRACT',
  LEGAL_OBLIGATION: 'LEGAL_OBLIGATION',
  VITAL_INTERESTS: 'VITAL_INTERESTS',
  PUBLIC_INTEREST: 'PUBLIC_INTEREST',
  LEGITIMATE_INTERESTS: 'LEGITIMATE_INTERESTS',
} as const;

export type LegalBasis = typeof LegalBasis[keyof typeof LegalBasis];

/**
 * Data Category Classification
 */
export const DataCategory = {
  IDENTIFIER: 'IDENTIFIER',           // Name, email, phone, etc.
  FINANCIAL: 'FINANCIAL',             // Payment info, bank details
  LOCATION: 'LOCATION',               // Address, GPS coordinates
  BIOMETRIC: 'BIOMETRIC',             // Fingerprints, facial recognition
  HEALTH: 'HEALTH',                   // Health-related information
  SENSITIVE: 'SENSITIVE',             // Special categories under GDPR Art. 9
  BEHAVIORAL: 'BEHAVIORAL',           // Usage patterns, preferences
  COMMUNICATION: 'COMMUNICATION',     // Emails, messages, call logs
  PROFESSIONAL: 'PROFESSIONAL',       // Employment, education
  DEVICE: 'DEVICE',                   // Device IDs, IP addresses
} as const;

export type DataCategory = typeof DataCategory[keyof typeof DataCategory];

/**
 * Consent Record
 */
export interface ConsentRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly dataSubjectId: string;
  readonly purpose: string;
  readonly legalBasis: LegalBasis;
  readonly dataCategories: readonly DataCategory[];
  readonly consentedAt: string;
  readonly expiresAt?: string;
  readonly withdrawnAt?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly consentText: string;
  readonly version: string;
}

/**
 * Data Subject Request
 */
export interface DataSubjectRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly dataSubjectId: string;
  readonly dataSubjectEmail: string;
  readonly requestType: DSRType;
  readonly applicableRegulations: readonly PrivacyRegulation[];
  readonly status: DSRStatus;
  readonly submittedAt: string;
  readonly deadlineAt: string;
  readonly completedAt?: string;
  readonly verifiedAt?: string;
  readonly rejectionReason?: string;
  readonly notes: string[];
  readonly artifacts?: readonly string[];
}

/**
 * Personal Data Inventory Entry
 */
export interface PersonalDataInventory {
  readonly fieldPath: string;          // e.g., "users.email", "leases.tenant_phone"
  readonly dataCategory: DataCategory;
  readonly sensitivity: 'low' | 'medium' | 'high' | 'critical';
  readonly legalBasis: LegalBasis;
  readonly retentionPeriodDays: number;
  readonly encryptedAtRest: boolean;
  readonly encryptedInTransit: boolean;
  readonly thirdPartyShared: boolean;
  readonly crossBorderTransfer: boolean;
  readonly purpose: string;
}

/**
 * Privacy Impact Assessment (PIA) / Data Protection Impact Assessment (DPIA)
 */
export interface PrivacyImpactAssessment {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly assessedBy: string;
  readonly assessedAt: string;
  readonly status: 'draft' | 'in_review' | 'approved' | 'requires_mitigation';
  readonly dataCategories: readonly DataCategory[];
  readonly processingPurposes: readonly string[];
  readonly risksIdentified: readonly PrivacyRisk[];
  readonly mitigations: readonly PrivacyMitigation[];
  readonly dpoApproval?: {
    approvedBy: string;
    approvedAt: string;
    comments?: string;
  };
}

export interface PrivacyRisk {
  readonly id: string;
  readonly description: string;
  readonly likelihood: 'low' | 'medium' | 'high';
  readonly impact: 'low' | 'medium' | 'high' | 'critical';
  readonly riskScore: number;
  readonly mitigated: boolean;
}

export interface PrivacyMitigation {
  readonly id: string;
  readonly riskId: string;
  readonly description: string;
  readonly implementedAt?: string;
  readonly effectiveness: 'partial' | 'full';
}

/**
 * Privacy Manager - Orchestrates privacy compliance operations
 */
export class PrivacyManager {
  private consents: Map<string, ConsentRecord[]> = new Map();
  private dsrRequests: Map<string, DataSubjectRequest> = new Map();
  private dataInventory: PersonalDataInventory[] = [];

  /**
   * Record consent from a data subject
   */
  recordConsent(consent: ConsentRecord): void {
    const subjectConsents = this.consents.get(consent.dataSubjectId) ?? [];
    this.consents.set(consent.dataSubjectId, [...subjectConsents, consent]);
  }

  /**
   * Withdraw consent for a specific purpose
   */
  withdrawConsent(dataSubjectId: string, purpose: string, withdrawnAt: string): boolean {
    const subjectConsents = this.consents.get(dataSubjectId);
    if (!subjectConsents) return false;

    const updated = subjectConsents.map(c => 
      c.purpose === purpose && !c.withdrawnAt
        ? { ...c, withdrawnAt }
        : c
    );
    this.consents.set(dataSubjectId, updated);
    return true;
  }

  /**
   * Check if consent is valid for a purpose
   */
  hasValidConsent(dataSubjectId: string, purpose: string): boolean {
    const subjectConsents = this.consents.get(dataSubjectId);
    if (!subjectConsents) return false;

    const now = new Date().toISOString();
    return subjectConsents.some(c => 
      c.purpose === purpose &&
      !c.withdrawnAt &&
      (!c.expiresAt || c.expiresAt > now)
    );
  }

  /**
   * Create a new Data Subject Request
   */
  createDSR(
    tenantId: string,
    dataSubjectId: string,
    dataSubjectEmail: string,
    requestType: DSRType,
    regulations: PrivacyRegulation[]
  ): DataSubjectRequest {
    const id = crypto.randomUUID();
    const submittedAt = new Date().toISOString();
    
    // Calculate deadline based on most stringent regulation
    const deadlineDays = this.getDeadlineDays(regulations, requestType);
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + deadlineDays);

    const request: DataSubjectRequest = {
      id,
      tenantId,
      dataSubjectId,
      dataSubjectEmail,
      requestType,
      applicableRegulations: regulations,
      status: DSRStatus.PENDING,
      submittedAt,
      deadlineAt: deadline.toISOString(),
      notes: [],
    };

    this.dsrRequests.set(id, request);
    return request;
  }

  /**
   * Get deadline days based on regulation requirements
   */
  private getDeadlineDays(regulations: PrivacyRegulation[], requestType: DSRType): number {
    // GDPR: 30 days, extendable to 90 for complex requests
    // CCPA: 45 days, extendable to 90
    // Use the most stringent (shortest) deadline
    const deadlines: Record<PrivacyRegulation, number> = {
      [PrivacyRegulation.GDPR]: 30,
      [PrivacyRegulation.CCPA]: 45,
      [PrivacyRegulation.CPRA]: 45,
      [PrivacyRegulation.LGPD]: 15,
      [PrivacyRegulation.POPIA]: 30,
      [PrivacyRegulation.PDPA]: 30,
    };

    return Math.min(...regulations.map(r => deadlines[r] ?? 30));
  }

  /**
   * Update DSR status
   */
  updateDSRStatus(
    requestId: string,
    status: DSRStatus,
    note?: string,
    rejectionReason?: string
  ): DataSubjectRequest | null {
    const request = this.dsrRequests.get(requestId);
    if (!request) return null;

    const updated: DataSubjectRequest = {
      ...request,
      status,
      completedAt: (
        [DSRStatus.COMPLETED, DSRStatus.REJECTED, DSRStatus.PARTIALLY_COMPLETED] as DSRStatus[]
      ).includes(status)
        ? new Date().toISOString()
        : undefined,
      rejectionReason: rejectionReason ?? request.rejectionReason,
      notes: note ? [...request.notes, note] : request.notes,
    };

    this.dsrRequests.set(requestId, updated);
    return updated;
  }

  /**
   * Get all pending DSRs approaching deadline
   */
  getUrgentDSRs(withinDays: number = 7): DataSubjectRequest[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + withinDays);
    const cutoffIso = cutoff.toISOString();

    return Array.from(this.dsrRequests.values()).filter(r =>
      ([DSRStatus.PENDING, DSRStatus.IDENTITY_VERIFICATION, DSRStatus.IN_PROGRESS] as DSRStatus[]).includes(r.status) &&
      r.deadlineAt <= cutoffIso
    );
  }

  /**
   * Register personal data inventory
   */
  registerDataInventory(inventory: PersonalDataInventory[]): void {
    this.dataInventory = inventory;
  }

  /**
   * Get data fields by category
   */
  getFieldsByCategory(category: DataCategory): PersonalDataInventory[] {
    return this.dataInventory.filter(f => f.dataCategory === category);
  }

  /**
   * Get high-sensitivity fields requiring extra protection
   */
  getHighSensitivityFields(): PersonalDataInventory[] {
    return this.dataInventory.filter(f => 
      f.sensitivity === 'high' || f.sensitivity === 'critical'
    );
  }

  /**
   * Generate data map for compliance documentation
   */
  generateDataMap(): {
    byCategory: Record<DataCategory, PersonalDataInventory[]>;
    byLegalBasis: Record<LegalBasis, PersonalDataInventory[]>;
    crossBorderTransfers: PersonalDataInventory[];
    thirdPartyShared: PersonalDataInventory[];
  } {
    const byCategory: Partial<Record<DataCategory, PersonalDataInventory[]>> = {};
    const byLegalBasis: Partial<Record<LegalBasis, PersonalDataInventory[]>> = {};
    const crossBorderTransfers: PersonalDataInventory[] = [];
    const thirdPartyShared: PersonalDataInventory[] = [];

    for (const field of this.dataInventory) {
      // Group by category
      if (!byCategory[field.dataCategory]) {
        byCategory[field.dataCategory] = [];
      }
      byCategory[field.dataCategory]!.push(field);

      // Group by legal basis
      if (!byLegalBasis[field.legalBasis]) {
        byLegalBasis[field.legalBasis] = [];
      }
      byLegalBasis[field.legalBasis]!.push(field);

      // Collect cross-border transfers
      if (field.crossBorderTransfer) {
        crossBorderTransfers.push(field);
      }

      // Collect third-party shared
      if (field.thirdPartyShared) {
        thirdPartyShared.push(field);
      }
    }

    return {
      byCategory: byCategory as Record<DataCategory, PersonalDataInventory[]>,
      byLegalBasis: byLegalBasis as Record<LegalBasis, PersonalDataInventory[]>,
      crossBorderTransfers,
      thirdPartyShared,
    };
  }

  /**
   * DSR Compliance Metrics
   */
  getDSRMetrics(): {
    totalRequests: number;
    byStatus: Record<DSRStatus, number>;
    byType: Record<DSRType, number>;
    averageCompletionDays: number;
    overdueCount: number;
  } {
    const requests = Array.from(this.dsrRequests.values());
    const now = new Date().toISOString();

    const byStatus: Partial<Record<DSRStatus, number>> = {};
    const byType: Partial<Record<DSRType, number>> = {};
    let totalCompletionDays = 0;
    let completedCount = 0;
    let overdueCount = 0;

    for (const request of requests) {
      // By status
      byStatus[request.status] = (byStatus[request.status] ?? 0) + 1;

      // By type
      byType[request.requestType] = (byType[request.requestType] ?? 0) + 1;

      // Completion time
      if (request.completedAt) {
        const submitted = new Date(request.submittedAt);
        const completed = new Date(request.completedAt);
        const days = Math.ceil((completed.getTime() - submitted.getTime()) / (1000 * 60 * 60 * 24));
        totalCompletionDays += days;
        completedCount++;
      }

      // Overdue
      if (
        ([DSRStatus.PENDING, DSRStatus.IDENTITY_VERIFICATION, DSRStatus.IN_PROGRESS] as DSRStatus[]).includes(request.status) &&
        request.deadlineAt < now
      ) {
        overdueCount++;
      }
    }

    return {
      totalRequests: requests.length,
      byStatus: byStatus as Record<DSRStatus, number>,
      byType: byType as Record<DSRType, number>,
      averageCompletionDays: completedCount > 0 ? Math.round(totalCompletionDays / completedCount) : 0,
      overdueCount,
    };
  }
}

/**
 * Zod schemas for API validation
 */
export const ConsentRecordSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string(),
  dataSubjectId: z.string(),
  purpose: z.string().min(1).max(500),
  legalBasis: z.nativeEnum(LegalBasis),
  dataCategories: z.array(z.nativeEnum(DataCategory)).min(1),
  consentedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  consentText: z.string().min(10),
  version: z.string(),
});

export const DSRRequestSchema = z.object({
  dataSubjectEmail: z.string().email(),
  requestType: z.nativeEnum(DSRType),
  applicableRegulations: z.array(z.nativeEnum(PrivacyRegulation)).min(1),
  additionalContext: z.string().max(2000).optional(),
});
