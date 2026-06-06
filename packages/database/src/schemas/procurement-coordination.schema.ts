/**
 * Procurement-coordination durable store (migration 0294) —
 * `@borjie/procurement-coordination` core entities.
 *
 * Eight tenant-scoped tables backing the Drizzle `ProcurementDataPort`:
 *   procurement_vendors          — vendor registry (KYC status, categories,
 *                                  bank details, certifications).
 *   procurement_kyc_documents    — per-vendor KYC document refs.
 *   procurement_budgets          — period budgets w/ spent/committed/reserved.
 *   procurement_requisitions     — purchase requests + approval/budget links.
 *   procurement_approval_chains  — resolved multi-level approval chains.
 *   procurement_approval_policies— per-(tenant, category) threshold rules.
 *   procurement_purchase_orders  — issued POs (spend-analytics source).
 *   procurement_vendor_invoices  — vendor invoices (3-way-match + spend).
 *
 * Nested value objects (bank details, certifications, line items, approval
 * steps, threshold rules) are stored as typed `jsonb` so the Drizzle port
 * round-trips them without a cast. Scalar money is `numeric` + a sibling
 * `currency` TEXT column — the amount + ISO-4217 code travel together; NO
 * currency literal anywhere (CLAUDE.md hard rule).
 *
 * Tenant scope (CLAUDE.md hard rule — mirrors migration 0294): tenant_id is
 * TEXT and FK→tenants; every table FORCE-enables RLS on the canonical
 * `app.current_tenant_id` GUC. The port also filters reads by tenantId
 * (defence in depth).
 *
 * Companion to:
 *   - packages/database/src/migrations/0294_procurement_coordination.sql
 *   - services/api-gateway/src/composition/procurement/drizzle-data-port.ts
 */

import {
  pgTable,
  text,
  numeric,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const procurementVendors = pgTable(
  'procurement_vendors',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    country: text('country').notNull(),
    companyName: text('company_name').notNull(),
    registrationNumber: text('registration_number').notNull().default(''),
    taxId: text('tax_id').notNull().default(''),
    /** pending|approved|rejected|blacklisted|expired. */
    kycStatus: text('kyc_status').notNull().default('pending'),
    categories: jsonb('categories').notNull().default([]),
    /** BankDetails | null. */
    bankDetails: jsonb('bank_details'),
    insuranceExpiresAt: text('insurance_expires_at'),
    certifications: jsonb('certifications').notNull().default([]),
    /** 1-5; null until first delivery completes. */
    rating: numeric('rating'),
    /** none|preferred|strategic. */
    preferredStatus: text('preferred_status').notNull().default('none'),
    contactEmail: text('contact_email').notNull().default(''),
    contactPhone: text('contact_phone'),
    statusReason: text('status_reason'),
    kycDecidedAt: timestamp('kyc_decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('procurement_vendors_tenant_idx').on(t.tenantId),
    tenantKycIdx: index('procurement_vendors_tenant_kyc_idx').on(
      t.tenantId,
      t.kycStatus,
    ),
  }),
);

export const procurementKycDocuments = pgTable(
  'procurement_kyc_documents',
  {
    id: text('id').primaryKey(),
    vendorId: text('vendor_id')
      .notNull()
      .references(() => procurementVendors.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentType: text('document_type').notNull(),
    fileUrl: text('file_url').notNull().default(''),
    /** Full KycDocument shape (verification status, expiry, etc.). */
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    vendorIdx: index('procurement_kyc_documents_vendor_idx').on(t.vendorId),
    tenantIdx: index('procurement_kyc_documents_tenant_idx').on(t.tenantId),
  }),
);

export const procurementBudgets = pgTable(
  'procurement_budgets',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** org|department|property|category. */
    scope: text('scope').notNull(),
    scopeKey: text('scope_key').notNull(),
    /** monthly|quarterly|annual. */
    period: text('period').notNull(),
    periodStart: text('period_start').notNull(),
    periodEnd: text('period_end').notNull(),
    amount: numeric('amount').notNull().default('0'),
    currency: text('currency').notNull(),
    spent: numeric('spent').notNull().default('0'),
    committed: numeric('committed').notNull().default('0'),
    reserved: numeric('reserved').notNull().default('0'),
    alertThresholdsPct: jsonb('alert_thresholds_pct').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('procurement_budgets_tenant_idx').on(t.tenantId),
    tenantScopeIdx: index('procurement_budgets_tenant_scope_idx').on(
      t.tenantId,
      t.scope,
      t.scopeKey,
    ),
  }),
);

export const procurementRequisitions = pgTable(
  'procurement_requisitions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    requestedBy: text('requested_by').notNull(),
    department: text('department'),
    propertyId: text('property_id'),
    items: jsonb('items').notNull().default([]),
    estimatedTotal: numeric('estimated_total').notNull().default('0'),
    currency: text('currency').notNull(),
    justification: text('justification').notNull().default(''),
    /** low|normal|high|emergency. */
    urgency: text('urgency').notNull().default('normal'),
    /** draft|submitted|approved|rejected|converted_to_rfq|converted_to_po|cancelled. */
    status: text('status').notNull().default('draft'),
    budgetId: text('budget_id'),
    approvalChainId: text('approval_chain_id'),
    rfqId: text('rfq_id'),
    poId: text('po_id'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('procurement_requisitions_tenant_idx').on(t.tenantId),
    tenantStatusIdx: index('procurement_requisitions_tenant_status_idx').on(
      t.tenantId,
      t.status,
    ),
  }),
);

export const procurementApprovalChains = pgTable(
  'procurement_approval_chains',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** requisition|po|invoice_exception. */
    subjectKind: text('subject_kind').notNull(),
    subjectId: text('subject_id').notNull(),
    amount: numeric('amount').notNull().default('0'),
    currency: text('currency').notNull(),
    steps: jsonb('steps').notNull().default([]),
    /** in_flight|approved|rejected. */
    status: text('status').notNull().default('in_flight'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('procurement_approval_chains_tenant_idx').on(t.tenantId),
    subjectIdx: index('procurement_approval_chains_subject_idx').on(
      t.tenantId,
      t.subjectId,
    ),
  }),
);

export const procurementApprovalPolicies = pgTable(
  'procurement_approval_policies',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** VendorCategory | 'all'. */
    category: text('category').notNull(),
    thresholds: jsonb('thresholds').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantCategoryIdx: uniqueIndex(
      'procurement_approval_policies_tenant_category_idx',
    ).on(t.tenantId, t.category),
  }),
);

export const procurementPurchaseOrders = pgTable(
  'procurement_purchase_orders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tenantSlug: text('tenant_slug').notNull().default(''),
    poNumber: text('po_number').notNull(),
    vendorId: text('vendor_id').notNull(),
    requisitionId: text('requisition_id'),
    rfqId: text('rfq_id'),
    bidId: text('bid_id'),
    frameworkAgreementId: text('framework_agreement_id'),
    items: jsonb('items').notNull().default([]),
    total: numeric('total').notNull().default('0'),
    currency: text('currency').notNull(),
    deliveryDate: text('delivery_date').notNull().default(''),
    deliveryAddress: text('delivery_address').notNull().default(''),
    paymentTerms: text('payment_terms').notNull().default(''),
    approvalChainId: text('approval_chain_id'),
    /** draft|pending_approval|approved|issued|received|closed|cancelled. */
    status: text('status').notNull().default('draft'),
    pdfUrl: text('pdf_url'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('procurement_purchase_orders_tenant_idx').on(t.tenantId),
    tenantVendorIdx: index('procurement_purchase_orders_tenant_vendor_idx').on(
      t.tenantId,
      t.vendorId,
    ),
    poNumberIdx: uniqueIndex('procurement_purchase_orders_po_number_idx').on(
      t.tenantId,
      t.poNumber,
    ),
  }),
);

export const procurementPoSequences = pgTable(
  'procurement_po_sequences',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    lastSeq: integer('last_seq').notNull().default(0),
  },
  (t) => ({
    pk: uniqueIndex('procurement_po_sequences_pk').on(t.tenantId, t.year),
  }),
);

export const procurementVendorInvoices = pgTable(
  'procurement_vendor_invoices',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    vendorId: text('vendor_id').notNull(),
    poId: text('po_id').notNull(),
    invoiceNumber: text('invoice_number').notNull(),
    lineItems: jsonb('line_items').notNull().default([]),
    total: numeric('total').notNull().default('0'),
    currency: text('currency').notNull(),
    issuedAt: text('issued_at').notNull().default(''),
    dueDate: text('due_date').notNull().default(''),
    /** submitted|matched|exception|approved_for_payment|paid|rejected. */
    status: text('status').notNull().default('submitted'),
    exceptionReasons: jsonb('exception_reasons').notNull().default([]),
    submittedAt: timestamp('submitted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('procurement_vendor_invoices_tenant_idx').on(t.tenantId),
    tenantVendorIdx: index('procurement_vendor_invoices_tenant_vendor_idx').on(
      t.tenantId,
      t.vendorId,
    ),
  }),
);

export type ProcurementVendorRow = typeof procurementVendors.$inferSelect;
export type ProcurementKycDocumentRow =
  typeof procurementKycDocuments.$inferSelect;
export type ProcurementBudgetRow = typeof procurementBudgets.$inferSelect;
export type ProcurementRequisitionRow =
  typeof procurementRequisitions.$inferSelect;
export type ProcurementApprovalChainRow =
  typeof procurementApprovalChains.$inferSelect;
export type ProcurementApprovalPolicyRow =
  typeof procurementApprovalPolicies.$inferSelect;
export type ProcurementPurchaseOrderRow =
  typeof procurementPurchaseOrders.$inferSelect;
export type ProcurementVendorInvoiceRow =
  typeof procurementVendorInvoices.$inferSelect;
