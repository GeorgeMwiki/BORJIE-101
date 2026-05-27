/**
 * BORJIE Domain Models
 * Shared domain models for the BORJIE platform
 */

// Common — value exports (non-duplicated names only). Domain files own
// the canonical definitions for names like SubscriptionTier, PaymentMethod,
// etc.; we re-export only what lives exclusively in common/*.
export {
  ActionStatusSchema, ActionTypeSchema, AssetCondition, AssetConditionSchema,
  AssetStatus, AssetStatusSchema, AuditEventTypeSchema, BadgeType,
  BadgeTypeSchema, CaseSeverity, CaseSeveritySchema, CaseStatus, CaseStatusSchema,
  CaseType, CaseTypeSchema, ChannelPreference, ChannelPreferenceSchema,
  CurrencyCodeSchema, CustomerStatusSchema, DeliveryMethod, DeliveryMethodSchema,
  DocumentSource, DocumentSourceSchema, DocumentStatus, DocumentStatusSchema,
  DocumentType, DocumentTypeSchema, EvidenceType, EvidenceTypeSchema,
  FraudRiskLevel, FraudRiskLevelSchema, IdDocumentTypeSchema, KycStatus,
  KycStatusSchema, LeaseStatusSchema, LeaseTypeSchema, LedgerAccountType,
  LedgerAccountTypeSchema, NoticeStatus, NoticeStatusSchema, NoticeType,
  NoticeTypeSchema, OccupancyStatus, OccupancyStatusSchema, OnboardingState,
  OnboardingStateSchema, PaymentMethodSchema, PaymentPlanStatusSchema,
  PaymentStatus, PaymentStatusSchema, PropertyStatusSchema, PropertyTypeSchema,
  RentFrequencySchema, ResolutionType, ResolutionTypeSchema, RiskLevelSchema,
  RiskTypeSchema, SegmentStatus, SegmentStatusSchema, SegmentType,
  SegmentTypeSchema, SessionStatusSchema, SubscriptionTierSchema,
  TenantStatusSchema, TerminationReason, TerminationReasonSchema,
  TimelineEventType, TimelineEventTypeSchema, UnitStatusSchema, UnitTypeSchema,
  UserStatusSchema, VendorStatusSchema, VerificationStatus,
  VerificationStatusSchema, WorkOrderCategorySchema, WorkOrderPrioritySchema,
  WorkOrderSourceSchema, WorkOrderStatusSchema,
} from './common/enums';
export type {
  AssetCondition as AssetConditionType, AssetStatus as AssetStatusType,
  BadgeType as BadgeTypeEnum, CaseSeverity as CaseSeverityType,
  CaseStatus as CaseStatusType, CaseType as CaseTypeEnum,
  ChannelPreference as ChannelPreferenceType, DeliveryMethod as DeliveryMethodType,
  DocumentSource as DocumentSourceType, DocumentStatus as DocumentStatusType,
  DocumentType as DocumentTypeEnum, EvidenceType as EvidenceTypeEnum,
  FraudRiskLevel as FraudRiskLevelType, KycStatus as KycStatusType,
  LedgerAccountType as LedgerAccountTypeEnum, NoticeStatus as NoticeStatusType,
  NoticeType as NoticeTypeEnum, OccupancyStatus as OccupancyStatusType,
  OnboardingState as OnboardingStateType, PaymentStatus as PaymentStatusType,
  ResolutionType as ResolutionTypeEnum, SegmentStatus as SegmentStatusType,
  SegmentType as SegmentTypeEnum, TerminationReason as TerminationReasonType,
  TimelineEventType as TimelineEventTypeEnum,
  VerificationStatus as VerificationStatusType,
} from './common/enums';

export {
  AccountTypeSchema, LedgerEntryTypeSchema, StatementPeriodTypeSchema,
  StatementStatusSchema, asAccountId, asArrearsCaseId, asAuditEventId,
  asCaseResolutionId, asCaseTimelineId, asCommunicationConsentId,
  asCompletionProofId, asCustomerId, asDeliveryReceiptId, asDispatchEventId,
  asDocumentAccessLogId, asDualSignOffId, asEscalationChainId,
  asEscalationChainRunId, asInvoiceId, asLeaseId, asLedgerEntryId,
  asMaintenanceRequestId, asMessageInstanceId, asMessageTemplateId,
  asOcrExtractionId, asOrganizationId, asOwnerStatementId, asPaymentIntentId,
  asPolicyId, asReceiptId, asRoleId, asSessionId, asStatementId, asTenantId,
  asTenantPreferenceId, asTransactionId, asUserId, createId, err, ok,
} from './common/types';
export type {
  AccountId, AccountType, ArrearsCaseId, AuditEventId, Brand, CaseResolutionId,
  CaseTimelineId, CommunicationConsentId, CustomerId, DeliveryReceiptId,
  DispatchEventId, DocumentAccessLogId, DualSignOffId, EntityMetadata,
  EscalationChainId, EscalationChainRunId, ISOTimestamp, InvoiceId, LeaseId,
  LedgerEntryId, LedgerEntryType, MaintenanceRequestId, MessageInstanceId,
  MessageTemplateId, OrganizationId, OwnerStatementId, PaginatedResult,
  PaginationParams, PaymentIntentId, PolicyId, ReceiptId, Result, RoleId,
  SessionId, SoftDeletable, StatementId, StatementPeriodType, StatementStatus,
  TenantId, TenantPreferenceId, TenantScoped, TenantScopedEntity, TransactionId,
  UserId,
} from './common/types';

export * from './common/money';
export * from './common/region-config';

// Per-country jurisdictional rules — new pluggable contract (Phase D).
// Currently TZ + KE. Adding a country is a single-object edit. See file
// header for the rationale on coexistence with region-config.ts.
export {
  getJurisdictionalRules,
  listSupportedJurisdictions,
  type JurisdictionalRules,
  type JurisdictionalIdentityDocType,
  type JurisdictionalTaxAuthority,
  type JurisdictionalLandRegistry,
  type JurisdictionalMobileMoneyProvider,
  type JurisdictionalBankRailProvider,
  type JurisdictionalLeaseRules,
  type JurisdictionalDataProtection,
} from './common/jurisdictional-rules.js';

// Tenant/Organization
export * from './tenant/tenant';
export * from './tenant/organization';
export * from './tenant/kenya-identifiers';

// Identity (Users, Roles, Sessions, Policies)
export * from './identity/user';
export * from './identity/role';
export * from './identity/session';
export * from './identity/policy';
export * from './identity/tenant-identity';
export * from './identity/authority-level';

// Audit
export * from './audit/audit-event';

// Geo — per-org elastic geo-hierarchy (NOT the country registry).
export * from './geo';

// Property management — property.ts and block.ts each declare their own
// calculateOccupancyRate. Expose block under a namespace.
export * from './property/property';
export * from './property/unit';
export * as Block from './property/block';

// Customer management
export * from './customer/customer';

// Lease management
export * as Lease from './lease/lease';
// occupancy re-exposed under a namespace so its helpers don't collide.
export * as Occupancy from './lease/occupancy';

// Payments
export * from './payments/payment-intent';
// BORJIE-42: payment-method was previously namespaced because the file
// declared its own PaymentMethodType. That symbol does not exist in
// common/enums (only PaymentMethod itself does, and we already skip
// re-exporting PaymentMethod from common/enums on line ~21), so the
// namespace wrapper was unnecessary. Flatten so api-client consumers
// can import `PaymentMethod`, `PaymentMethodId`, `PaymentMethodType`,
// etc. directly.
export * from './payments/payment-method';

// BORJIE-42: aliases for api-client surface. Some api-client services
// were authored against an earlier draft of these names; preserve both
// forms so existing payment-intent consumers keep working AND the
// api-client compiles without further import rewrites.
export type { PaymentStatus as PaymentIntentStatus } from './common/enums';
export type { PaymentIntentType as PaymentType } from './payments/payment-intent';

// Financial — each module exports its own mark*/assign*/resolve* helpers
// with the same names. Namespace them.
export * as Invoice from './financial/invoice';
export * as Transaction from './financial/transaction';
export * as Receipt from './financial/receipt';
export * as ArrearsCase from './financial/arrears-case';

// Payment plans
export * from './payment/payment-plan';

// Ledger and accounting
export * from './ledger/account';
export * from './ledger/ledger-entry';

// Statements
export * from './statements/statement';

// Maintenance and work orders.
// BORJIE-42: work-order.ts previously re-declared VendorId/asVendorId,
// which forced this module to live behind a `WorkOrder` namespace
// wrapper. work-order.ts now imports VendorId as a type from vendor.ts,
// so the module is safe to flat-export. This unblocks api-client
// services (work-orders.ts, sla.ts) which need direct WorkOrderId /
// WorkOrderStatus / WorkOrderPriority / WorkOrderCategory imports.
export * from './maintenance/work-order';
export * from './maintenance/inspection';
export * from './maintenance/vendor';
export * from './maintenance/vendor-scorecard';
export * from './maintenance/vendor-assignment';

// Operations
export * from './operations/asset';
export * from './operations/maintenance-request';
export * from './operations/dispatch-event';
export * as CompletionProof from './operations/completion-proof';
export * as DualSignoff from './operations/dual-signoff';

// Legal — case/notice/evidence-attachment share helper names; namespace them.
export * as Case from './legal/case';
export * from './legal/timeline-event';
export * as EvidenceAttachment from './legal/evidence-attachment';
export * as Notice from './legal/notice';
export * from './legal/notice-service-receipt';

// Documents
export * from './documents/document-upload';
export * from './documents/verification-badge';
export * from './documents/fraud-risk-score';

// Intelligence (AI Personalization)
export * from './intelligence/index';

// Notifications
export * from './notifications/notification';
