/**
 * Autonomy types — Wave-13 Autonomous Department Mode.
 *
 * The head of estates configures a single AutonomyPolicy per tenant that
 * tells Mr. Mwikila exactly what he may do on his own authority, what he
 * must surface for approval, and who to escalate to when the trail runs
 * out. Every domain has its own rule block so heads can delegate finance
 * aggressively while keeping compliance on tight rails.
 *
 * Shapes mirror the Drizzle schema at
 * `packages/database/src/schemas/autonomy.schema.ts` — the `policyJson`
 * column carries the serialised `AutonomyPolicy` without its tenantId
 * (that lives in the row's primary key).
 */

export type AutonomyDomain =
  | 'finance'
  | 'leasing'
  | 'maintenance'
  | 'compliance'
  | 'communications'
  // Wave 27 Part B.9 additions — full estate-business domain coverage.
  | 'marketing'
  | 'hr'
  | 'procurement'
  | 'insurance'
  | 'legal_proceedings'
  | 'tenant_welfare';

export const AUTONOMY_DOMAINS: readonly AutonomyDomain[] = [
  'finance',
  'leasing',
  'maintenance',
  'compliance',
  'communications',
  'marketing',
  'hr',
  'procurement',
  'insurance',
  'legal_proceedings',
  'tenant_welfare',
] as const;

export type AutonomyActionType =
  | 'auto_send'
  | 'auto_approve'
  | 'threshold'
  | 'escalation'
  | 'review_window'
  | 'disabled';

export const AUTONOMY_ACTION_TYPES: readonly AutonomyActionType[] = [
  'auto_send',
  'auto_approve',
  'threshold',
  'escalation',
  'review_window',
  'disabled',
] as const;

/**
 * Finance — collections, receipts, refunds, waivers.
 */
export interface FinancePolicy {
  readonly autoSendReminders: boolean;
  /** Day offsets from invoice due-date at which reminders auto-send. */
  readonly reminderDayOffsets: readonly number[];
  readonly autoApproveRefundsMinorUnits: number;
  readonly autoApproveWaiversMinorUnits: number;
  /** Above this balance an arrears case is escalated instead of auto-actioned. */
  readonly escalateArrearsAboveMinorUnits: number;
}

/**
 * Leasing — applications, renewals, terminations.
 */
export interface LeasingPolicy {
  readonly autoApproveRenewalsSameTerms: boolean;
  readonly maxAutoApproveRentIncreasePct: number;
  readonly autoApproveApplicationScoreMin: number;
  readonly autoSendOfferLetters: boolean;
}

/**
 * Maintenance — work-order approvals.
 */
export interface MaintenancePolicy {
  readonly autoApproveBelowMinorUnits: number;
  readonly autoDispatchTrustedVendors: boolean;
  readonly autoCloseResolvedTickets: boolean;
  readonly escalateSafetyCriticalImmediately: boolean;
}

/**
 * Compliance — licences, notices, regulatory communications.
 */
export interface CompliancePolicy {
  readonly autoDraftNotices: boolean;
  /** Legal notices NEVER auto-send — safety-critical default. */
  readonly autoSendLegalNotices: false;
  readonly autoRenewLicencesBefore: number;
  readonly escalateOnNewRegulation: boolean;
}

/**
 * Communications — tenant / owner messaging tone + templates.
 */
export interface CommunicationsPolicy {
  readonly autoSendRoutineUpdates: boolean;
  readonly autoTranslateToTenantLanguage: boolean;
  readonly escalateNegativeSentimentScoreBelow: number;
  readonly quietHoursStartHour: number;
  readonly quietHoursEndHour: number;
}

/** Wave 27 Part B.9 — Marketing: listings, promotions, open-house blasts. */
export interface MarketingPolicy {
  readonly autoPublishListings: boolean;
  readonly autoAdjustAskingRentPct: number;
  readonly autoSendOpenHouseInvites: boolean;
  readonly monthlyAdSpendCapMinorUnits: number;
}

/** Wave 27 Part B.9 — HR: contractor onboarding, payroll approvals. */
export interface HRPolicy {
  readonly autoOnboardContractors: boolean;
  readonly autoApprovePayrollBelowMinorUnits: number;
  readonly autoIssueCertificatesOfEmployment: boolean;
}

/** Wave 27 Part B.9 — Procurement: supply contracts, PO approvals. */
export interface ProcurementPolicy {
  readonly autoIssuePurchaseOrdersBelowMinorUnits: number;
  readonly autoRenewVendorContracts: boolean;
  readonly escalateSingleSourceAwards: boolean;
}

/** Wave 27 Part B.9 — Insurance: policy renewals, claim intake. */
export interface InsurancePolicy {
  readonly autoRenewPoliciesBeforeDays: number;
  readonly autoFileClaimsBelowMinorUnits: number;
  readonly escalateCoverageGaps: boolean;
}

/** Wave 27 Part B.9 — Legal proceedings (eviction, arbitration).
 *  AI drafts but humans file — safety-critical default. */
export interface LegalProceedingsPolicy {
  readonly autoDraftEvictionNotices: boolean;
  /** Legal filings NEVER auto-submit. */
  readonly autoFileToTribunal: false;
  readonly autoScheduleMediation: boolean;
}

/** Wave 27 Part B.9 — Tenant welfare: hardship cases, resident programs. */
export interface TenantWelfarePolicy {
  readonly autoOfferPaymentPlansBelowMinorUnits: number;
  readonly autoEnrollInHardshipRelief: boolean;
  readonly escalateVulnerableHouseholds: boolean;
}

export interface EscalationContacts {
  readonly primaryUserId: string | null;
  readonly secondaryUserId: string | null;
  readonly fallbackEmails: readonly string[];
}

/** Full per-tenant policy. Stored as `policyJson` + related row columns. */
export interface AutonomyPolicy {
  readonly tenantId: string;
  readonly autonomousModeEnabled: boolean;
  readonly finance: FinancePolicy;
  readonly leasing: LeasingPolicy;
  readonly maintenance: MaintenancePolicy;
  readonly compliance: CompliancePolicy;
  readonly communications: CommunicationsPolicy;
  // Wave 27 Part B.9 — every domain a real estate business actually runs.
  readonly marketing: MarketingPolicy;
  readonly hr: HRPolicy;
  readonly procurement: ProcurementPolicy;
  readonly insurance: InsurancePolicy;
  readonly legal_proceedings: LegalProceedingsPolicy;
  readonly tenant_welfare: TenantWelfarePolicy;
  readonly escalation: EscalationContacts;
  readonly version: number;
  readonly updatedAt: string;
  readonly updatedBy: string | null;
}

/** What a consumer passes when asking whether an autonomous action is allowed. */
export interface AuthorizeContext {
  readonly amountMinorUnits?: number;
  readonly rentIncreasePct?: number;
  readonly isLegalNotice?: boolean;
  readonly isSafetyCritical?: boolean;
  readonly applicationScore?: number;
  readonly sentimentScore?: number;
  readonly vendorIsTrusted?: boolean;
}

export interface AuthorizationDecision {
  readonly authorized: boolean;
  readonly requiresApproval: boolean;
  readonly escalateTo: string | null;
  readonly reason: string;
  readonly policyRuleMatched: string;
}

export interface AutonomyPolicyRepository {
  get(tenantId: string): Promise<AutonomyPolicy | null>;
  upsert(policy: AutonomyPolicy): Promise<AutonomyPolicy>;
}

/** Inputs accepted by updatePolicy — any subset of domain blocks. */
export interface UpdatePolicyInput {
  readonly autonomousModeEnabled?: boolean;
  readonly finance?: Partial<FinancePolicy>;
  readonly leasing?: Partial<LeasingPolicy>;
  readonly maintenance?: Partial<MaintenancePolicy>;
  readonly compliance?: Partial<CompliancePolicy>;
  readonly communications?: Partial<CommunicationsPolicy>;
  // Wave 27 Part B.9 additions.
  readonly marketing?: Partial<MarketingPolicy>;
  readonly hr?: Partial<HRPolicy>;
  readonly procurement?: Partial<ProcurementPolicy>;
  readonly insurance?: Partial<InsurancePolicy>;
  readonly legal_proceedings?: Partial<LegalProceedingsPolicy>;
  readonly tenant_welfare?: Partial<TenantWelfarePolicy>;
  readonly escalation?: Partial<EscalationContacts>;
  readonly updatedBy?: string;
}
