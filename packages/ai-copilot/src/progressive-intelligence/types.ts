/**
 * Progressive Intelligence Types — BORJIE estate management port.
 *
 * Accumulates structured data from user turns + uploaded docs + filled
 * forms into a typed AccumulatedEstateContext per session.
 *
 * @module progressive-intelligence/types
 */

export type ConfidenceTier = 'high' | 'medium' | 'low';

export type DataSource =
  | 'chat'
  | 'document'
  | 'form'
  | 'lpms_import'
  | 'inferred'
  | 'user_confirmed';

// ============================================================================
// AccumulatedEstateContext
// ============================================================================

export interface AccumulatedEstateContext {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly createdAt: string;
  readonly updatedAt: string;

  readonly property: PropertyDraft;
  readonly tenantProfile: TenantProfileDraft;
  readonly leaseTerms: LeaseTermsDraft;
  readonly maintenanceCase: MaintenanceCaseDraft;
  readonly migrationBatch: MigrationBatchDraft;
  readonly renewalProposal: RenewalProposalDraft;
  readonly complianceNotice: ComplianceNoticeDraft;

  readonly fieldMetadata: Record<string, FieldMetadata>;
  readonly version: number;
}

export interface PropertyDraft {
  readonly propertyId?: string;
  readonly unitId?: string;
  readonly propertyRef?: string;
  readonly district?: string;
  readonly blockRef?: string;
  readonly unitLabel?: string;
}

export interface TenantProfileDraft {
  readonly tenantName?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly nationalId?: string;
  readonly countryCode?: string;
  readonly occupation?: string;
  readonly employerName?: string;
  readonly monthlyIncomeCents?: number;
}

export interface LeaseTermsDraft {
  readonly monthlyRentCents?: number;
  readonly currency?: string;
  readonly depositCents?: number;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly tenureMonths?: number;
  readonly escalationPct?: number;
  readonly paymentDayOfMonth?: number;
}

export interface MaintenanceCaseDraft {
  readonly category?:
    | 'plumbing'
    | 'electrical'
    | 'hvac'
    | 'structural'
    | 'appliance'
    | 'cleaning'
    | 'pest'
    | 'security'
    | 'other';
  readonly severity?: 'low' | 'medium' | 'high' | 'critical';
  readonly description?: string;
  readonly reportedAt?: string;
  readonly evidence?: readonly string[];
  readonly preferredVisitDate?: string;
}

export interface MigrationBatchDraft {
  readonly sourceSystem?: string;
  readonly sourceFile?: string;
  readonly detectedEntities?: readonly string[];
  readonly rowCountTotal?: number;
  readonly rowCountParsed?: number;
  readonly rowCountFailed?: number;
  readonly unresolvedFields?: readonly string[];
}

export interface RenewalProposalDraft {
  readonly existingRentCents?: number;
  readonly proposedRentCents?: number;
  readonly incrementPct?: number;
  readonly proposedTermMonths?: number;
  readonly incentives?: readonly string[];
  readonly justification?: string;
}

export interface ComplianceNoticeDraft {
  readonly noticeType?:
    | 'default'
    | 'termination'
    | 'inspection'
    | 'renewal'
    | 'rate_adjustment'
    | 'compliance_breach';
  readonly recipientName?: string;
  readonly issueDate?: string;
  readonly complianceFindings?: readonly string[];
  readonly ruleReferences?: readonly string[];
}

export interface FieldMetadata {
  readonly updatedAt: string;
  readonly source: DataSource;
  readonly confidence: number;
  readonly confidenceTier: ConfidenceTier;
  readonly confirmed: boolean;
  readonly rawValue?: string | undefined;
  readonly sourceDocumentId?: string | undefined;
}

// ============================================================================
// Events
// ============================================================================

export type ContextChangeKind =
  | 'field_updated'
  | 'section_ready'
  | 'validation_failed'
  | 'version_snapshotted'
  | 'research_triggered'
  | 'auto_generation_ready';

export interface ContextChangeEvent {
  readonly type: ContextChangeKind;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly fieldPath?: string;
  readonly newValue?: unknown;
  readonly affectedSections?: readonly string[];
  readonly timestamp: string;
  readonly version: number;
}

export type ContextChangeListener = (event: ContextChangeEvent) => void;

// ============================================================================
// Readiness
// ============================================================================

export interface SectionReadiness {
  readonly sectionId: string;
  readonly completionPct: number;
  readonly filledCount: number;
  readonly totalCount: number;
  readonly missingFields: readonly string[];
  readonly canGenerate: boolean;
}

export interface ReadinessReport {
  readonly sessionId: string;
  readonly overallPct: number;
  readonly sections: readonly SectionReadiness[];
  readonly suggestions: readonly string[];
}
