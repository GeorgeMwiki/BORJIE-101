/**
 * Common types used across domain models
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

/** Brand type for type-safe IDs */
export type Brand<T, B> = T & { __brand: B };

/** Branded UUID string types for different entities */
export type TenantId = Brand<string, 'TenantId'>;
export type OrganizationId = Brand<string, 'OrganizationId'>;
export type UserId = Brand<string, 'UserId'>;
export type RoleId = Brand<string, 'RoleId'>;
export type PolicyId = Brand<string, 'PolicyId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type AuditEventId = Brand<string, 'AuditEventId'>;
export type CustomerId = Brand<string, 'CustomerId'>;
export type LeaseId = Brand<string, 'LeaseId'>;
export type PaymentIntentId = Brand<string, 'PaymentIntentId'>;
export type StatementId = Brand<string, 'StatementId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type OwnerId = Brand<string, 'OwnerId'>;
export type PropertyId = Brand<string, 'PropertyId'>;
export type LedgerEntryId = Brand<string, 'LedgerEntryId'>;
export type UnitId = Brand<string, 'UnitId'>;
export type BlockId = Brand<string, 'BlockId'>;
export type AssetId = Brand<string, 'AssetId'>;

// Financial domain IDs
export type InvoiceId = Brand<string, 'InvoiceId'>;
export type ReceiptId = Brand<string, 'ReceiptId'>;
export type TransactionId = Brand<string, 'TransactionId'>;
export type PaymentPlanId = Brand<string, 'PaymentPlanId'>;
export type ArrearsCaseId = Brand<string, 'ArrearsCaseId'>;
export type OwnerStatementId = Brand<string, 'OwnerStatementId'>;

// Operations domain IDs
export type MaintenanceRequestId = Brand<string, 'MaintenanceRequestId'>;
export type WorkOrderId = Brand<string, 'WorkOrderId'>;
export type VendorId = Brand<string, 'VendorId'>;
export type VendorScorecardId = Brand<string, 'VendorScorecardId'>;
export type DispatchEventId = Brand<string, 'DispatchEventId'>;
export type CompletionProofId = Brand<string, 'CompletionProofId'>;
export type DualSignOffId = Brand<string, 'DualSignOffId'>;
export type VendorAssignmentId = Brand<string, 'VendorAssignmentId'>;

// Intelligence domain IDs
export type TenantPreferenceId = Brand<string, 'TenantPreferenceId'>;
export type FrictionFingerprintId = Brand<string, 'FrictionFingerprintId'>;
export type RiskScoreId = Brand<string, 'RiskScoreId'>;
export type NextBestActionId = Brand<string, 'NextBestActionId'>;
export type InterventionLogId = Brand<string, 'InterventionLogId'>;
export type TenantSegmentId = Brand<string, 'TenantSegmentId'>;
export type CustomerSegmentMembershipId = Brand<string, 'CustomerSegmentMembershipId'>;

// Legal domain IDs
export type CaseId = Brand<string, 'CaseId'>;
export type CaseTimelineId = Brand<string, 'CaseTimelineId'>;
export type EvidenceAttachmentId = Brand<string, 'EvidenceAttachmentId'>;
export type CaseResolutionId = Brand<string, 'CaseResolutionId'>;
export type NoticeId = Brand<string, 'NoticeId'>;
export type NoticeServiceReceiptId = Brand<string, 'NoticeServiceReceiptId'>;

// Document domain IDs
export type DocumentUploadId = Brand<string, 'DocumentUploadId'>;
export type OcrExtractionId = Brand<string, 'OcrExtractionId'>;
export type IdentityProfileId = Brand<string, 'IdentityProfileId'>;
export type VerificationBadgeId = Brand<string, 'VerificationBadgeId'>;
export type DocumentAccessLogId = Brand<string, 'DocumentAccessLogId'>;

// Communications domain IDs
export type MessageTemplateId = Brand<string, 'MessageTemplateId'>;
export type MessageInstanceId = Brand<string, 'MessageInstanceId'>;
export type DeliveryReceiptId = Brand<string, 'DeliveryReceiptId'>;
export type CommunicationConsentId = Brand<string, 'CommunicationConsentId'>;
export type EscalationChainId = Brand<string, 'EscalationChainId'>;
export type EscalationChainRunId = Brand<string, 'EscalationChainRunId'>;

/** Type guard helpers for branded types */
export function asTenantId(id: string): TenantId {
  return id as TenantId;
}

export function asOrganizationId(id: string): OrganizationId {
  return id as OrganizationId;
}

export function asUserId(id: string): UserId {
  return id as UserId;
}

export function asRoleId(id: string): RoleId {
  return id as RoleId;
}

export function asPolicyId(id: string): PolicyId {
  return id as PolicyId;
}

export function asSessionId(id: string): SessionId {
  return id as SessionId;
}

export function asAuditEventId(id: string): AuditEventId {
  return id as AuditEventId;
}

export function asCustomerId(id: string): CustomerId {
  return id as CustomerId;
}

export function asLeaseId(id: string): LeaseId {
  return id as LeaseId;
}

export function asPaymentIntentId(id: string): PaymentIntentId {
  return id as PaymentIntentId;
}

export function asStatementId(id: string): StatementId {
  return id as StatementId;
}

export function asAccountId(id: string): AccountId {
  return id as AccountId;
}

export function asOwnerId(id: string): OwnerId {
  return id as OwnerId;
}

export function asPropertyId(id: string): PropertyId {
  return id as PropertyId;
}

export function asLedgerEntryId(id: string): LedgerEntryId {
  return id as LedgerEntryId;
}

export function asUnitId(id: string): UnitId {
  return id as UnitId;
}

export function asBlockId(id: string): BlockId {
  return id as BlockId;
}

export function asAssetId(id: string): AssetId {
  return id as AssetId;
}

// Financial domain ID helpers
export function asInvoiceId(id: string): InvoiceId {
  return id as InvoiceId;
}

export function asReceiptId(id: string): ReceiptId {
  return id as ReceiptId;
}

export function asTransactionId(id: string): TransactionId {
  return id as TransactionId;
}

export function asPaymentPlanId(id: string): PaymentPlanId {
  return id as PaymentPlanId;
}

export function asArrearsCaseId(id: string): ArrearsCaseId {
  return id as ArrearsCaseId;
}

export function asOwnerStatementId(id: string): OwnerStatementId {
  return id as OwnerStatementId;
}

// Operations domain ID helpers
export function asMaintenanceRequestId(id: string): MaintenanceRequestId {
  return id as MaintenanceRequestId;
}

export function asWorkOrderId(id: string): WorkOrderId {
  return id as WorkOrderId;
}

export function asVendorId(id: string): VendorId {
  return id as VendorId;
}

export function asVendorScorecardId(id: string): VendorScorecardId {
  return id as VendorScorecardId;
}

export function asDispatchEventId(id: string): DispatchEventId {
  return id as DispatchEventId;
}

export function asCompletionProofId(id: string): CompletionProofId {
  return id as CompletionProofId;
}

export function asDualSignOffId(id: string): DualSignOffId {
  return id as DualSignOffId;
}

export function asVendorAssignmentId(id: string): VendorAssignmentId {
  return id as VendorAssignmentId;
}

// Intelligence domain ID helpers
export function asTenantPreferenceId(id: string): TenantPreferenceId {
  return id as TenantPreferenceId;
}

export function asFrictionFingerprintId(id: string): FrictionFingerprintId {
  return id as FrictionFingerprintId;
}

export function asRiskScoreId(id: string): RiskScoreId {
  return id as RiskScoreId;
}

export function asNextBestActionId(id: string): NextBestActionId {
  return id as NextBestActionId;
}

export function asInterventionLogId(id: string): InterventionLogId {
  return id as InterventionLogId;
}

export function asTenantSegmentId(id: string): TenantSegmentId {
  return id as TenantSegmentId;
}

export function asCustomerSegmentMembershipId(id: string): CustomerSegmentMembershipId {
  return id as CustomerSegmentMembershipId;
}

// Legal domain ID helpers
export function asCaseId(id: string): CaseId {
  return id as CaseId;
}

export function asCaseTimelineId(id: string): CaseTimelineId {
  return id as CaseTimelineId;
}

export function asEvidenceAttachmentId(id: string): EvidenceAttachmentId {
  return id as EvidenceAttachmentId;
}

export function asCaseResolutionId(id: string): CaseResolutionId {
  return id as CaseResolutionId;
}

export function asNoticeId(id: string): NoticeId {
  return id as NoticeId;
}

export function asNoticeServiceReceiptId(id: string): NoticeServiceReceiptId {
  return id as NoticeServiceReceiptId;
}

// Document domain ID helpers
export function asDocumentUploadId(id: string): DocumentUploadId {
  return id as DocumentUploadId;
}

export function asOcrExtractionId(id: string): OcrExtractionId {
  return id as OcrExtractionId;
}

export function asIdentityProfileId(id: string): IdentityProfileId {
  return id as IdentityProfileId;
}

export function asVerificationBadgeId(id: string): VerificationBadgeId {
  return id as VerificationBadgeId;
}

export function asDocumentAccessLogId(id: string): DocumentAccessLogId {
  return id as DocumentAccessLogId;
}

// Communications domain ID helpers
export function asMessageTemplateId(id: string): MessageTemplateId {
  return id as MessageTemplateId;
}

export function asMessageInstanceId(id: string): MessageInstanceId {
  return id as MessageInstanceId;
}

export function asDeliveryReceiptId(id: string): DeliveryReceiptId {
  return id as DeliveryReceiptId;
}

export function asCommunicationConsentId(id: string): CommunicationConsentId {
  return id as CommunicationConsentId;
}

export function asEscalationChainId(id: string): EscalationChainId {
  return id as EscalationChainId;
}

export function asEscalationChainRunId(id: string): EscalationChainRunId {
  return id as EscalationChainRunId;
}

/** Create a new UUID */
export function createId(): string {
  return uuidv4();
}

// ============================================================================
// Zod Schemas for ledger, statements, payments
// ============================================================================

// Wave-27 Agent E — BORJIE now ships for the whole world, not just
// East Africa + 4 reserve currencies. The canonical ISO-4217 decimal
// table lives in `./currencies.ts` (140+ codes incl. JPY/KRW/BHD/CLF).
// We keep a small curated "well-known" list for autocompletion so tools
// like intellisense still suggest the common 15, but the exported
// `CurrencyCode` type is `string` so consumers can pass any valid
// ISO-4217 code (validation happens in the zod schema via regex).
const WELL_KNOWN_CURRENCIES = [
  'KES', 'USD', 'EUR', 'GBP', 'TZS', 'UGX', 'RWF',
  'JPY', 'KRW', 'CNY', 'INR', 'AED', 'ZAR', 'NGN', 'BRL',
] as const;
/** Currency code — any ISO-4217 3-letter string. Validated via regex. */
export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'currency must be ISO-4217 (3 upper-case letters)');
/**
 * `CurrencyCode` is typed as `string` so all 140+ ISO-4217 codes are
 * assignable (JPY, KRW, BHD, CLF, etc.). For tools that want a typed
 * "well-known" set, use {@link WellKnownCurrency} which narrows to the
 * 15 most common codes.
 */
export type CurrencyCode = string;
export type WellKnownCurrency = (typeof WELL_KNOWN_CURRENCIES)[number];
export { WELL_KNOWN_CURRENCIES };

export const StatementPeriodTypeSchema = z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM']);
export type StatementPeriodType = z.infer<typeof StatementPeriodTypeSchema>;

export const StatementStatusSchema = z.enum(['DRAFT', 'GENERATED', 'SENT', 'VIEWED']);
export type StatementStatus = z.infer<typeof StatementStatusSchema>;

export const PaymentStatusSchema = z.enum([
  'PENDING', 'PROCESSING', 'REQUIRES_ACTION', 'SUCCEEDED', 'FAILED',
  'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const AccountTypeSchema = z.enum([
  'CUSTOMER_LIABILITY', 'CUSTOMER_DEPOSIT', 'OWNER_OPERATING', 'OWNER_RESERVE',
  'PLATFORM_REVENUE', 'PLATFORM_HOLDING'
]);
export type AccountType = z.infer<typeof AccountTypeSchema>;

export const LedgerEntryTypeSchema = z.enum([
  'RENT_CHARGE', 'RENT_PAYMENT', 'LATE_FEE', 'DEPOSIT_PAYMENT', 'DEPOSIT_REFUND',
  'PLATFORM_FEE', 'OWNER_DISBURSEMENT', 'OWNER_CONTRIBUTION'
]);
export type LedgerEntryType = z.infer<typeof LedgerEntryTypeSchema>;

/** Tenant-scoped entity with audit fields (for ledger, statements, payments) */
export interface TenantScopedEntity {
  readonly tenantId: TenantId;
  readonly createdAt: Date;
  readonly createdBy: string;
  // updatedAt / updatedBy are mutable because domain methods update them.
  updatedAt: Date;
  updatedBy: string;
}

/** ISO 8601 timestamp string */
export type ISOTimestamp = string;

/** Standard entity metadata */
export interface EntityMetadata {
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId;
  readonly updatedBy: UserId;
}

/** Soft-deletable entity */
export interface SoftDeletable {
  readonly deletedAt: ISOTimestamp | null;
  readonly deletedBy: UserId | null;
}

/** Tenant-scoped entity - enforces tenant isolation at type level */
export interface TenantScoped {
  readonly tenantId: TenantId;
}

/**
 * Result type for operations that can fail.
 *
 * Provides dual-shape ergonomics: callers may destructure either
 *   - `{ success, data, error }` (legacy)
 *   - `{ ok, value, error }` (idiomatic Rust-style)
 *
 * Both are present on every instance so migrating a caller is a
 * rename-only change with no runtime wrapping required.
 */
export type Result<T, E = Error> =
  | { success: true; ok: true; data: T; value: T }
  | { success: false; ok: false; error: E };

/** Create a success result */
export function ok<T>(data: T): Result<T, never> {
  return { success: true, ok: true, data, value: data };
}

/** Create a failure result */
export function err<E>(error: E): Result<never, E> {
  return { success: false, ok: false, error };
}

/** Pagination parameters */
export interface PaginationParams {
  readonly limit: number;
  readonly offset: number;
}

/** Paginated result */
export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}
