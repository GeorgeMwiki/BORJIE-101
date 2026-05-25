/**
 * Comprehensive enums for BORJIE domain models
 * All status fields, categories, and severity levels from PRD Section 9
 */

import { z } from 'zod';

// ============================================================================
// Tenant & Organization Enums
// ============================================================================

export const TenantStatus = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  PENDING: 'pending',
  TRIAL: 'trial',
  CANCELLED: 'cancelled',
} as const;
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];
export const TenantStatusSchema = z.enum(['active', 'suspended', 'pending', 'trial', 'cancelled']);

export const SubscriptionTier = {
  STARTER: 'starter',
  PROFESSIONAL: 'professional',
  ENTERPRISE: 'enterprise',
  CUSTOM: 'custom',
} as const;
export type SubscriptionTier = (typeof SubscriptionTier)[keyof typeof SubscriptionTier];
export const SubscriptionTierSchema = z.enum(['starter', 'professional', 'enterprise', 'custom']);

// ============================================================================
// User & Session Enums
// ============================================================================

export const UserStatus = {
  PENDING_ACTIVATION: 'pending_activation',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DEACTIVATED: 'deactivated',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export const UserStatusSchema = z.enum(['pending_activation', 'active', 'suspended', 'deactivated']);

export const SessionStatus = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];
export const SessionStatusSchema = z.enum(['active', 'expired', 'revoked']);

// ============================================================================
// Property & Unit Enums
// ============================================================================

export const PropertyType = {
  APARTMENT_COMPLEX: 'apartment_complex',
  SINGLE_FAMILY: 'single_family',
  MULTI_FAMILY: 'multi_family',
  TOWNHOUSE: 'townhouse',
  COMMERCIAL: 'commercial',
  MIXED_USE: 'mixed_use',
  ESTATE: 'estate',
  OTHER: 'other',
} as const;
export type PropertyType = (typeof PropertyType)[keyof typeof PropertyType];
export const PropertyTypeSchema = z.enum([
  'apartment_complex', 'single_family', 'multi_family', 'townhouse',
  'commercial', 'mixed_use', 'estate', 'other'
]);

export const PropertyStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  UNDER_MAINTENANCE: 'under_maintenance',
  SOLD: 'sold',
  ARCHIVED: 'archived',
} as const;
export type PropertyStatus = (typeof PropertyStatus)[keyof typeof PropertyStatus];
export const PropertyStatusSchema = z.enum(['draft', 'active', 'inactive', 'under_maintenance', 'sold', 'archived']);

export const UnitType = {
  STUDIO: 'studio',
  ONE_BEDROOM: 'one_bedroom',
  TWO_BEDROOM: 'two_bedroom',
  THREE_BEDROOM: 'three_bedroom',
  FOUR_PLUS_BEDROOM: 'four_plus_bedroom',
  PENTHOUSE: 'penthouse',
  DUPLEX: 'duplex',
  LOFT: 'loft',
  COMMERCIAL_RETAIL: 'commercial_retail',
  COMMERCIAL_OFFICE: 'commercial_office',
  WAREHOUSE: 'warehouse',
  PARKING: 'parking',
  STORAGE: 'storage',
  OTHER: 'other',
} as const;
export type UnitType = (typeof UnitType)[keyof typeof UnitType];
export const UnitTypeSchema = z.enum([
  'studio', 'one_bedroom', 'two_bedroom', 'three_bedroom', 'four_plus_bedroom',
  'penthouse', 'duplex', 'loft', 'commercial_retail', 'commercial_office',
  'warehouse', 'parking', 'storage', 'other'
]);

export const UnitStatus = {
  VACANT: 'vacant',
  OCCUPIED: 'occupied',
  RESERVED: 'reserved',
  UNDER_MAINTENANCE: 'under_maintenance',
  NOT_AVAILABLE: 'not_available',
} as const;
export type UnitStatus = (typeof UnitStatus)[keyof typeof UnitStatus];
export const UnitStatusSchema = z.enum(['vacant', 'occupied', 'reserved', 'under_maintenance', 'not_available']);

// ============================================================================
// Customer Enums
// ============================================================================

export const CustomerStatus = {
  PROSPECT: 'prospect',
  APPLICANT: 'applicant',
  APPROVED: 'approved',
  ACTIVE: 'active',
  FORMER: 'former',
  BLACKLISTED: 'blacklisted',
} as const;
export type CustomerStatus = (typeof CustomerStatus)[keyof typeof CustomerStatus];
export const CustomerStatusSchema = z.enum(['prospect', 'applicant', 'approved', 'active', 'former', 'blacklisted']);

export const KycStatus = {
  PENDING: 'pending',
  IN_REVIEW: 'in_review',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
} as const;
export type KycStatus = (typeof KycStatus)[keyof typeof KycStatus];
export const KycStatusSchema = z.enum(['pending', 'in_review', 'verified', 'rejected', 'expired']);

export const IdDocumentType = {
  NATIONAL_ID: 'national_id',
  PASSPORT: 'passport',
  DRIVING_LICENSE: 'driving_license',
  MILITARY_ID: 'military_id',
  VOTER_ID: 'voter_id',
  WORK_PERMIT: 'work_permit',
  OTHER: 'other',
} as const;
export type IdDocumentType = (typeof IdDocumentType)[keyof typeof IdDocumentType];
export const IdDocumentTypeSchema = z.enum(['national_id', 'passport', 'driving_license', 'military_id', 'voter_id', 'work_permit', 'other']);

// ============================================================================
// Lease Enums
// ============================================================================

export const LeaseStatus = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  ACTIVE: 'active',
  EXPIRING_SOON: 'expiring_soon',
  EXPIRED: 'expired',
  TERMINATED: 'terminated',
  RENEWED: 'renewed',
  CANCELLED: 'cancelled',
} as const;
export type LeaseStatus = (typeof LeaseStatus)[keyof typeof LeaseStatus];
export const LeaseStatusSchema = z.enum([
  'draft', 'pending_approval', 'approved', 'active', 'expiring_soon',
  'expired', 'terminated', 'renewed', 'cancelled'
]);

export const LeaseType = {
  FIXED_TERM: 'fixed_term',
  MONTH_TO_MONTH: 'month_to_month',
  SHORT_TERM: 'short_term',
  CORPORATE: 'corporate',
  STUDENT: 'student',
  SUBSIDIZED: 'subsidized',
} as const;
export type LeaseType = (typeof LeaseType)[keyof typeof LeaseType];
export const LeaseTypeSchema = z.enum(['fixed_term', 'month_to_month', 'short_term', 'corporate', 'student', 'subsidized']);

export const RentFrequency = {
  WEEKLY: 'weekly',
  BI_WEEKLY: 'bi_weekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  SEMI_ANNUALLY: 'semi_annually',
  ANNUALLY: 'annually',
} as const;
export type RentFrequency = (typeof RentFrequency)[keyof typeof RentFrequency];
export const RentFrequencySchema = z.enum(['weekly', 'bi_weekly', 'monthly', 'quarterly', 'semi_annually', 'annually']);

export const TerminationReason = {
  END_OF_TERM: 'end_of_term',
  MUTUAL_AGREEMENT: 'mutual_agreement',
  TENANT_REQUEST: 'tenant_request',
  LANDLORD_REQUEST: 'landlord_request',
  NON_PAYMENT: 'non_payment',
  LEASE_VIOLATION: 'lease_violation',
  PROPERTY_SALE: 'property_sale',
  PROPERTY_DAMAGE: 'property_damage',
  EVICTION: 'eviction',
  OTHER: 'other',
} as const;
export type TerminationReason = (typeof TerminationReason)[keyof typeof TerminationReason];
export const TerminationReasonSchema = z.enum([
  'end_of_term', 'mutual_agreement', 'tenant_request', 'landlord_request',
  'non_payment', 'lease_violation', 'property_sale', 'property_damage', 'eviction', 'other'
]);

// ============================================================================
// Occupancy Enums
// ============================================================================

export const OccupancyStatus = {
  PENDING_MOVE_IN: 'pending_move_in',
  ACTIVE: 'active',
  NOTICE_GIVEN: 'notice_given',
  PENDING_MOVE_OUT: 'pending_move_out',
  MOVED_OUT: 'moved_out',
  EVICTED: 'evicted',
  ABANDONED: 'abandoned',
} as const;
export type OccupancyStatus = (typeof OccupancyStatus)[keyof typeof OccupancyStatus];
export const OccupancyStatusSchema = z.enum([
  'pending_move_in', 'active', 'notice_given', 'pending_move_out',
  'moved_out', 'evicted', 'abandoned'
]);

export const OnboardingState = {
  A0_PRE_MOVE_IN: 'a0_pre_move_in',
  A1_WELCOME_SETUP: 'a1_welcome_setup',
  A2_UTILITIES: 'a2_utilities',
  A3_ORIENTATION: 'a3_orientation',
  A4_CONDITION_REPORT: 'a4_condition_report',
  A5_COMMUNITY_CONTEXT: 'a5_community_context',
  A6_COMPLETE: 'a6_complete',
} as const;
export type OnboardingState = (typeof OnboardingState)[keyof typeof OnboardingState];
export const OnboardingStateSchema = z.enum([
  'a0_pre_move_in', 'a1_welcome_setup', 'a2_utilities', 'a3_orientation',
  'a4_condition_report', 'a5_community_context', 'a6_complete'
]);

// ============================================================================
// Invoice & Payment Enums
// ============================================================================

export const InvoiceStatus = {
  DRAFT: 'draft',
  PENDING: 'pending',
  SENT: 'sent',
  VIEWED: 'viewed',
  PARTIALLY_PAID: 'partially_paid',
  PAID: 'paid',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled',
  VOID: 'void',
  WRITTEN_OFF: 'written_off',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];
export const InvoiceStatusSchema = z.enum([
  'draft', 'pending', 'sent', 'viewed', 'partially_paid', 'paid',
  'overdue', 'cancelled', 'void', 'written_off'
]);

export const InvoiceType = {
  RENT: 'rent',
  DEPOSIT: 'deposit',
  UTILITIES: 'utilities',
  MAINTENANCE: 'maintenance',
  LATE_FEE: 'late_fee',
  OTHER: 'other',
} as const;
export type InvoiceType = (typeof InvoiceType)[keyof typeof InvoiceType];
export const InvoiceTypeSchema = z.enum(['rent', 'deposit', 'utilities', 'maintenance', 'late_fee', 'other']);

export const PaymentStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];
export const PaymentStatusSchema = z.enum([
  'pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded', 'partially_refunded'
]);

export const PaymentMethod = {
  MPESA: 'mpesa',
  BANK_TRANSFER: 'bank_transfer',
  CARD: 'card',
  CASH: 'cash',
  CHEQUE: 'cheque',
  OTHER: 'other',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];
export const PaymentMethodSchema = z.enum(['mpesa', 'bank_transfer', 'card', 'cash', 'cheque', 'other']);

export const TransactionType = {
  CHARGE: 'charge',
  PAYMENT: 'payment',
  CREDIT: 'credit',
  ADJUSTMENT: 'adjustment',
  REFUND: 'refund',
  WRITE_OFF: 'write_off',
  DEPOSIT_HOLD: 'deposit_hold',
  DEPOSIT_RELEASE: 'deposit_release',
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];
export const TransactionTypeSchema = z.enum([
  'charge', 'payment', 'credit', 'adjustment', 'refund',
  'write_off', 'deposit_hold', 'deposit_release'
]);

export const ReceiptStatus = {
  DRAFT: 'draft',
  ISSUED: 'issued',
  VOIDED: 'voided',
  SUPERSEDED: 'superseded',
} as const;
export type ReceiptStatus = (typeof ReceiptStatus)[keyof typeof ReceiptStatus];
export const ReceiptStatusSchema = z.enum(['draft', 'issued', 'voided', 'superseded']);

export const PaymentPlanStatus = {
  PROPOSED: 'proposed',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  DEFAULTED: 'defaulted',
  CANCELLED: 'cancelled',
} as const;
export type PaymentPlanStatus = (typeof PaymentPlanStatus)[keyof typeof PaymentPlanStatus];
export const PaymentPlanStatusSchema = z.enum([
  'proposed', 'pending_approval', 'approved', 'active', 'completed', 'defaulted', 'cancelled'
]);

export const ArrearsStatus = {
  ACTIVE: 'active',
  PAYMENT_PLAN: 'payment_plan',
  LEGAL_ACTION: 'legal_action',
  SETTLED: 'settled',
  WRITTEN_OFF: 'written_off',
  DISPUTED: 'disputed',
} as const;
export type ArrearsStatus = (typeof ArrearsStatus)[keyof typeof ArrearsStatus];
export const ArrearsStatusSchema = z.enum([
  'active', 'payment_plan', 'legal_action', 'settled', 'written_off', 'disputed'
]);

export const LedgerAccountType = {
  ASSET: 'asset',
  LIABILITY: 'liability',
  EQUITY: 'equity',
  REVENUE: 'revenue',
  EXPENSE: 'expense',
} as const;
export type LedgerAccountType = (typeof LedgerAccountType)[keyof typeof LedgerAccountType];
export const LedgerAccountTypeSchema = z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']);

// ============================================================================
// Maintenance Enums
// ============================================================================

export const WorkOrderPriority = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
  EMERGENCY: 'emergency',
} as const;
export type WorkOrderPriority = (typeof WorkOrderPriority)[keyof typeof WorkOrderPriority];
export const WorkOrderPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent', 'emergency']);

export const WorkOrderStatus = {
  SUBMITTED: 'submitted',
  TRIAGED: 'triaged',
  ASSIGNED: 'assigned',
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  PENDING_PARTS: 'pending_parts',
  COMPLETED: 'completed',
  VERIFIED: 'verified',
  REOPENED: 'reopened',
  CANCELLED: 'cancelled',
} as const;
export type WorkOrderStatus = (typeof WorkOrderStatus)[keyof typeof WorkOrderStatus];
export const WorkOrderStatusSchema = z.enum([
  'submitted', 'triaged', 'assigned', 'scheduled', 'in_progress',
  'pending_parts', 'completed', 'verified', 'reopened', 'cancelled'
]);

export const WorkOrderCategory = {
  PLUMBING: 'plumbing',
  ELECTRICAL: 'electrical',
  HVAC: 'hvac',
  APPLIANCE: 'appliance',
  STRUCTURAL: 'structural',
  PEST_CONTROL: 'pest_control',
  LANDSCAPING: 'landscaping',
  CLEANING: 'cleaning',
  SECURITY: 'security',
  OTHER: 'other',
} as const;
export type WorkOrderCategory = (typeof WorkOrderCategory)[keyof typeof WorkOrderCategory];
export const WorkOrderCategorySchema = z.enum([
  'plumbing', 'electrical', 'hvac', 'appliance', 'structural',
  'pest_control', 'landscaping', 'cleaning', 'security', 'other'
]);

export const WorkOrderSource = {
  CUSTOMER_REQUEST: 'customer_request',
  INSPECTION: 'inspection',
  PREVENTIVE: 'preventive',
  EMERGENCY: 'emergency',
  MANAGER_CREATED: 'manager_created',
} as const;
export type WorkOrderSource = (typeof WorkOrderSource)[keyof typeof WorkOrderSource];
export const WorkOrderSourceSchema = z.enum(['customer_request', 'inspection', 'preventive', 'emergency', 'manager_created']);

export const MaintenanceRequestStatus = {
  SUBMITTED: 'submitted',
  ACKNOWLEDGED: 'acknowledged',
  PENDING_INFO: 'pending_info',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CONVERTED_TO_WO: 'converted_to_wo',
  CANCELLED: 'cancelled',
} as const;
export type MaintenanceRequestStatus = (typeof MaintenanceRequestStatus)[keyof typeof MaintenanceRequestStatus];
export const MaintenanceRequestStatusSchema = z.enum([
  'submitted', 'acknowledged', 'pending_info', 'approved', 'rejected', 'converted_to_wo', 'cancelled'
]);

export const DispatchStatus = {
  PENDING: 'pending',
  NOTIFIED: 'notified',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  EN_ROUTE: 'en_route',
  ARRIVED: 'arrived',
  COMPLETED: 'completed',
  NO_SHOW: 'no_show',
  RESCHEDULED: 'rescheduled',
} as const;
export type DispatchStatus = (typeof DispatchStatus)[keyof typeof DispatchStatus];
export const DispatchStatusSchema = z.enum([
  'pending', 'notified', 'accepted', 'declined', 'en_route',
  'arrived', 'completed', 'no_show', 'rescheduled'
]);

export const VendorStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  PROBATION: 'probation',
  SUSPENDED: 'suspended',
  BLACKLISTED: 'blacklisted',
} as const;
export type VendorStatus = (typeof VendorStatus)[keyof typeof VendorStatus];
export const VendorStatusSchema = z.enum(['active', 'inactive', 'probation', 'suspended', 'blacklisted']);

export const AssetStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  UNDER_MAINTENANCE: 'under_maintenance',
  RETIRED: 'retired',
  DISPOSED: 'disposed',
} as const;
export type AssetStatus = (typeof AssetStatus)[keyof typeof AssetStatus];
export const AssetStatusSchema = z.enum(['active', 'inactive', 'under_maintenance', 'retired', 'disposed']);

export const AssetCondition = {
  EXCELLENT: 'excellent',
  GOOD: 'good',
  FAIR: 'fair',
  POOR: 'poor',
  CRITICAL: 'critical',
} as const;
export type AssetCondition = (typeof AssetCondition)[keyof typeof AssetCondition];
export const AssetConditionSchema = z.enum(['excellent', 'good', 'fair', 'poor', 'critical']);

// ============================================================================
// Intelligence Enums
// ============================================================================

export const RiskLevel = {
  VERY_LOW: 'very_low',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  VERY_HIGH: 'very_high',
  CRITICAL: 'critical',
} as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];
export const RiskLevelSchema = z.enum(['very_low', 'low', 'medium', 'high', 'very_high', 'critical']);

export const RiskType = {
  PAYMENT: 'payment',
  CHURN: 'churn',
  DISPUTE: 'dispute',
  MAINTENANCE: 'maintenance',
  COMPLIANCE: 'compliance',
} as const;
export type RiskType = (typeof RiskType)[keyof typeof RiskType];
export const RiskTypeSchema = z.enum(['payment', 'churn', 'dispute', 'maintenance', 'compliance']);

export const ActionType = {
  SEND_REMINDER: 'send_reminder',
  OFFER_PAYMENT_PLAN: 'offer_payment_plan',
  SCHEDULE_CALL: 'schedule_call',
  SEND_RENEWAL_OFFER: 'send_renewal_offer',
  SERVICE_RECOVERY: 'service_recovery',
  PROACTIVE_MAINTENANCE: 'proactive_maintenance',
  LOYALTY_REWARD: 'loyalty_reward',
  ESCALATE_TO_MANAGER: 'escalate_to_manager',
  LEGAL_NOTICE: 'legal_notice',
  COMMUNITY_ENGAGEMENT: 'community_engagement',
  FEEDBACK_REQUEST: 'feedback_request',
  CHECK_IN: 'check_in',
} as const;
export type ActionType = (typeof ActionType)[keyof typeof ActionType];
export const ActionTypeSchema = z.enum([
  'send_reminder', 'offer_payment_plan', 'schedule_call', 'send_renewal_offer',
  'service_recovery', 'proactive_maintenance', 'loyalty_reward', 'escalate_to_manager',
  'legal_notice', 'community_engagement', 'feedback_request', 'check_in'
]);

export const ActionStatus = {
  RECOMMENDED: 'recommended',
  APPROVED: 'approved',
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
  EXPIRED: 'expired',
  FAILED: 'failed',
} as const;
export type ActionStatus = (typeof ActionStatus)[keyof typeof ActionStatus];
export const ActionStatusSchema = z.enum([
  'recommended', 'approved', 'scheduled', 'in_progress', 'completed', 'skipped', 'expired', 'failed'
]);

export const ChannelPreference = {
  WHATSAPP: 'whatsapp',
  SMS: 'sms',
  EMAIL: 'email',
  APP_PUSH: 'app_push',
  VOICE_CALL: 'voice_call',
  IN_PERSON: 'in_person',
} as const;
export type ChannelPreference = (typeof ChannelPreference)[keyof typeof ChannelPreference];
export const ChannelPreferenceSchema = z.enum(['whatsapp', 'sms', 'email', 'app_push', 'voice_call', 'in_person']);

export const SegmentType = {
  PAYMENT_BEHAVIOR: 'payment_behavior',
  COMMUNICATION_PREFERENCE: 'communication_preference',
  LIFECYCLE_STAGE: 'lifecycle_stage',
  RISK_PROFILE: 'risk_profile',
  VALUE_TIER: 'value_tier',
  ENGAGEMENT_LEVEL: 'engagement_level',
  MAINTENANCE_PATTERN: 'maintenance_pattern',
  CUSTOM: 'custom',
} as const;
export type SegmentType = (typeof SegmentType)[keyof typeof SegmentType];
export const SegmentTypeSchema = z.enum([
  'payment_behavior', 'communication_preference', 'lifecycle_stage', 'risk_profile',
  'value_tier', 'engagement_level', 'maintenance_pattern', 'custom'
]);

export const SegmentStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ARCHIVED: 'archived',
} as const;
export type SegmentStatus = (typeof SegmentStatus)[keyof typeof SegmentStatus];
export const SegmentStatusSchema = z.enum(['active', 'inactive', 'archived']);

// ============================================================================
// Case & Legal Enums
// ============================================================================

export const CaseType = {
  ARREARS: 'arrears',
  DEPOSIT_DISPUTE: 'deposit_dispute',
  DAMAGE_CLAIM: 'damage_claim',
  LEASE_VIOLATION: 'lease_violation',
  NOISE_COMPLAINT: 'noise_complaint',
  MAINTENANCE_DISPUTE: 'maintenance_dispute',
  EVICTION: 'eviction',
  HARASSMENT: 'harassment',
  SAFETY_CONCERN: 'safety_concern',
  BILLING_DISPUTE: 'billing_dispute',
  OTHER: 'other',
} as const;
export type CaseType = (typeof CaseType)[keyof typeof CaseType];
export const CaseTypeSchema = z.enum([
  'arrears', 'deposit_dispute', 'damage_claim', 'lease_violation', 'noise_complaint',
  'maintenance_dispute', 'eviction', 'harassment', 'safety_concern', 'billing_dispute', 'other'
]);

export const CaseSeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
  URGENT: 'urgent',
} as const;
export type CaseSeverity = (typeof CaseSeverity)[keyof typeof CaseSeverity];
export const CaseSeveritySchema = z.enum(['low', 'medium', 'high', 'critical', 'urgent']);

export const CaseStatus = {
  OPEN: 'open',
  INVESTIGATING: 'investigating',
  PENDING_RESPONSE: 'pending_response',
  PENDING_EVIDENCE: 'pending_evidence',
  MEDIATION: 'mediation',
  ESCALATED: 'escalated',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
  WITHDRAWN: 'withdrawn',
} as const;
export type CaseStatus = (typeof CaseStatus)[keyof typeof CaseStatus];
export const CaseStatusSchema = z.enum([
  'open', 'investigating', 'pending_response', 'pending_evidence',
  'mediation', 'escalated', 'resolved', 'closed', 'withdrawn'
]);

export const TimelineEventType = {
  CASE_CREATED: 'case_created',
  STATUS_CHANGED: 'status_changed',
  EVIDENCE_ADDED: 'evidence_added',
  NOTE_ADDED: 'note_added',
  NOTICE_SENT: 'notice_sent',
  RESPONSE_RECEIVED: 'response_received',
  ESCALATED: 'escalated',
  ASSIGNED: 'assigned',
  RESOLUTION_PROPOSED: 'resolution_proposed',
  RESOLUTION_ACCEPTED: 'resolution_accepted',
  RESOLUTION_REJECTED: 'resolution_rejected',
  CLOSED: 'closed',
} as const;
export type TimelineEventType = (typeof TimelineEventType)[keyof typeof TimelineEventType];
export const TimelineEventTypeSchema = z.enum([
  'case_created', 'status_changed', 'evidence_added', 'note_added', 'notice_sent',
  'response_received', 'escalated', 'assigned', 'resolution_proposed',
  'resolution_accepted', 'resolution_rejected', 'closed'
]);

export const ResolutionType = {
  PAYMENT_PLAN: 'payment_plan',
  PARTIAL_PAYMENT: 'partial_payment',
  FULL_PAYMENT: 'full_payment',
  DEPOSIT_DEDUCTION: 'deposit_deduction',
  MUTUAL_AGREEMENT: 'mutual_agreement',
  MEDIATION_OUTCOME: 'mediation_outcome',
  COURT_ORDER: 'court_order',
  EVICTION: 'eviction',
  LEASE_TERMINATION: 'lease_termination',
  WARNING_ISSUED: 'warning_issued',
  NO_ACTION: 'no_action',
  WITHDRAWN: 'withdrawn',
  OTHER: 'other',
} as const;
export type ResolutionType = (typeof ResolutionType)[keyof typeof ResolutionType];
export const ResolutionTypeSchema = z.enum([
  'payment_plan', 'partial_payment', 'full_payment', 'deposit_deduction',
  'mutual_agreement', 'mediation_outcome', 'court_order', 'eviction',
  'lease_termination', 'warning_issued', 'no_action', 'withdrawn', 'other'
]);

export const EvidenceType = {
  DOCUMENT: 'document',
  PHOTO: 'photo',
  VIDEO: 'video',
  AUDIO: 'audio',
  COMMUNICATION_LOG: 'communication_log',
  PAYMENT_RECORD: 'payment_record',
  INSPECTION_REPORT: 'inspection_report',
  WITNESS_STATEMENT: 'witness_statement',
  LEGAL_DOCUMENT: 'legal_document',
  OTHER: 'other',
} as const;
export type EvidenceType = (typeof EvidenceType)[keyof typeof EvidenceType];
export const EvidenceTypeSchema = z.enum([
  'document', 'photo', 'video', 'audio', 'communication_log',
  'payment_record', 'inspection_report', 'witness_statement', 'legal_document', 'other'
]);

export const NoticeType = {
  PAYMENT_REMINDER: 'payment_reminder',
  PAYMENT_DEMAND: 'payment_demand',
  LATE_FEE_NOTICE: 'late_fee_notice',
  LEASE_VIOLATION: 'lease_violation',
  NOISE_WARNING: 'noise_warning',
  INSPECTION_NOTICE: 'inspection_notice',
  ENTRY_NOTICE: 'entry_notice',
  RENEWAL_OFFER: 'renewal_offer',
  NON_RENEWAL: 'non_renewal',
  TERMINATION: 'termination',
  EVICTION_WARNING: 'eviction_warning',
  EVICTION_NOTICE: 'eviction_notice',
  DEPOSIT_DEDUCTION: 'deposit_deduction',
  MOVE_OUT_INSTRUCTIONS: 'move_out_instructions',
  LEGAL_DEMAND: 'legal_demand',
  COURT_SUMMONS: 'court_summons',
  OTHER: 'other',
} as const;
export type NoticeType = (typeof NoticeType)[keyof typeof NoticeType];
export const NoticeTypeSchema = z.enum([
  'payment_reminder', 'payment_demand', 'late_fee_notice', 'lease_violation', 'noise_warning',
  'inspection_notice', 'entry_notice', 'renewal_offer', 'non_renewal', 'termination',
  'eviction_warning', 'eviction_notice', 'deposit_deduction', 'move_out_instructions',
  'legal_demand', 'court_summons', 'other'
]);

export const NoticeStatus = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  SCHEDULED: 'scheduled',
  SENT: 'sent',
  DELIVERED: 'delivered',
  ACKNOWLEDGED: 'acknowledged',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  VOIDED: 'voided',
} as const;
export type NoticeStatus = (typeof NoticeStatus)[keyof typeof NoticeStatus];
export const NoticeStatusSchema = z.enum([
  'draft', 'pending_approval', 'approved', 'scheduled', 'sent',
  'delivered', 'acknowledged', 'expired', 'cancelled', 'voided'
]);

export const DeliveryMethod = {
  EMAIL: 'email',
  SMS: 'sms',
  WHATSAPP: 'whatsapp',
  IN_APP: 'in_app',
  PHYSICAL_MAIL: 'physical_mail',
  HAND_DELIVERY: 'hand_delivery',
  COURIER: 'courier',
  POSTED_ON_DOOR: 'posted_on_door',
} as const;
export type DeliveryMethod = (typeof DeliveryMethod)[keyof typeof DeliveryMethod];
export const DeliveryMethodSchema = z.enum([
  'email', 'sms', 'whatsapp', 'in_app', 'physical_mail', 'hand_delivery', 'courier', 'posted_on_door'
]);

// ============================================================================
// Document Enums
// ============================================================================

export const DocumentType = {
  NATIONAL_ID: 'national_id',
  PASSPORT: 'passport',
  DRIVING_LICENSE: 'driving_license',
  WORK_PERMIT: 'work_permit',
  RESIDENCE_PERMIT: 'residence_permit',
  UTILITY_BILL: 'utility_bill',
  BANK_STATEMENT: 'bank_statement',
  EMPLOYMENT_LETTER: 'employment_letter',
  LEASE_AGREEMENT: 'lease_agreement',
  MOVE_IN_REPORT: 'move_in_report',
  MOVE_OUT_REPORT: 'move_out_report',
  MAINTENANCE_PHOTO: 'maintenance_photo',
  RECEIPT: 'receipt',
  NOTICE: 'notice',
  OTHER: 'other',
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];
export const DocumentTypeSchema = z.enum([
  'national_id', 'passport', 'driving_license', 'work_permit', 'residence_permit',
  'utility_bill', 'bank_statement', 'employment_letter', 'lease_agreement',
  'move_in_report', 'move_out_report', 'maintenance_photo', 'receipt', 'notice', 'other'
]);

export const DocumentStatus = {
  PENDING_UPLOAD: 'pending_upload',
  UPLOADED: 'uploaded',
  PROCESSING: 'processing',
  OCR_COMPLETE: 'ocr_complete',
  VALIDATED: 'validated',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  ARCHIVED: 'archived',
} as const;
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];
export const DocumentStatusSchema = z.enum([
  'pending_upload', 'uploaded', 'processing', 'ocr_complete', 'validated', 'rejected', 'expired', 'archived'
]);

export const DocumentSource = {
  WHATSAPP: 'whatsapp',
  APP_UPLOAD: 'app_upload',
  EMAIL: 'email',
  SCAN: 'scan',
  API: 'api',
  MANUAL: 'manual',
} as const;
export type DocumentSource = (typeof DocumentSource)[keyof typeof DocumentSource];
export const DocumentSourceSchema = z.enum(['whatsapp', 'app_upload', 'email', 'scan', 'api', 'manual']);

export const VerificationStatus = {
  PENDING: 'pending',
  IN_REVIEW: 'in_review',
  VERIFIED: 'verified',
  PARTIALLY_VERIFIED: 'partially_verified',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  MANUAL_OVERRIDE: 'manual_override',
} as const;
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];
export const VerificationStatusSchema = z.enum([
  'pending', 'in_review', 'verified', 'partially_verified', 'rejected', 'expired', 'manual_override'
]);

export const BadgeType = {
  IDENTITY_VERIFIED: 'identity_verified',
  ADDRESS_VERIFIED: 'address_verified',
  INCOME_VERIFIED: 'income_verified',
  EMPLOYER_VERIFIED: 'employer_verified',
  REFERENCES_VERIFIED: 'references_verified',
  KYC_COMPLETE: 'kyc_complete',
  PREMIUM_TENANT: 'premium_tenant',
} as const;
export type BadgeType = (typeof BadgeType)[keyof typeof BadgeType];
export const BadgeTypeSchema = z.enum([
  'identity_verified', 'address_verified', 'income_verified', 'employer_verified',
  'references_verified', 'kyc_complete', 'premium_tenant'
]);

export const FraudRiskLevel = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;
export type FraudRiskLevel = (typeof FraudRiskLevel)[keyof typeof FraudRiskLevel];
export const FraudRiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

// ============================================================================
// Audit Enums
// ============================================================================

export const AuditEventType = {
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',
  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout',
  USER_PASSWORD_CHANGED: 'user.password_changed',
  TENANT_CREATED: 'tenant.created',
  TENANT_UPDATED: 'tenant.updated',
  TENANT_SUSPENDED: 'tenant.suspended',
  ROLE_ASSIGNED: 'role.assigned',
  ROLE_REVOKED: 'role.revoked',
  PERMISSION_GRANTED: 'permission.granted',
  PERMISSION_REVOKED: 'permission.revoked',
  DATA_ACCESSED: 'data.accessed',
  DATA_MODIFIED: 'data.modified',
  DATA_EXPORTED: 'data.exported',
} as const;
export type AuditEventType = (typeof AuditEventType)[keyof typeof AuditEventType];
export const AuditEventTypeSchema = z.enum([
  'user.created', 'user.updated', 'user.deleted', 'user.login', 'user.logout',
  'user.password_changed', 'tenant.created', 'tenant.updated', 'tenant.suspended',
  'role.assigned', 'role.revoked', 'permission.granted', 'permission.revoked',
  'data.accessed', 'data.modified', 'data.exported'
]);

// ============================================================================
// Currency
// ============================================================================

// Wave-27 — BORJIE ships globally (Kenya/Tanzania as first-class just
// as US/Germany/Korea). The canonical ISO-4217 decimal table lives in
// `./currencies.ts` (140+ codes). We keep a well-known object here for
// autocomplete + back-compat (the 7 original EAC+reserve codes), but
// `CurrencyCode` itself is a broad `string` type so any valid ISO-4217
// code validates. Use `CurrencyCodeSchema` (regex-based) for runtime checks.
export const CurrencyCode = {
  KES: 'KES',
  TZS: 'TZS',
  UGX: 'UGX',
  RWF: 'RWF',
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  JPY: 'JPY',
  KRW: 'KRW',
  CNY: 'CNY',
  INR: 'INR',
  AED: 'AED',
  ZAR: 'ZAR',
  NGN: 'NGN',
  BRL: 'BRL',
} as const;
/** Broad ISO-4217 currency code type. Accepts any 3-letter upper-case string. */
export type CurrencyCode = string;
/** Compile-time narrowed type of the well-known set (autocomplete only). */
export type WellKnownCurrency = (typeof CurrencyCode)[keyof typeof CurrencyCode];
export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'currency must be ISO-4217 (3 upper-case letters)');
