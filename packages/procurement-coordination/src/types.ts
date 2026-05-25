/**
 * Public types for `@borjie/procurement-coordination`.
 *
 * Pure type module — no runtime. Every type is `readonly` end-to-end
 * so consumers cannot mutate procurement records after they are
 * produced. This is an audit-grade module: edits flow as new event
 * objects, never as mutations on the in-flight record.
 *
 * The module covers the full procure-to-pay (P2P) lifecycle:
 *
 *   Requisition → Approval → RFQ/Tender → Bid → Award → PO →
 *   Issuance → Goods Receipt → Invoice → 3-Way Match → Payment.
 *
 * Per-jurisdiction KYC rules vary (TZ TRA + BRELA; KE KRA + NCA;
 * UG URSB; RW RRA; NG CAC + FIRS) so the vendor registry is keyed
 * by country code with a typed checklist.
 */

// ─────────────────────────────────────────────────────────────────────
// Common shapes
// ─────────────────────────────────────────────────────────────────────

/** ISO-3166-1 alpha-2 country code (e.g. 'KE', 'TZ', 'UG'). */
export type CountryCode = string;

/** ISO-4217 currency code (e.g. 'KES', 'TZS', 'USD'). */
export type CurrencyCode = string;

/** ISO-8601 instant. */
export type IsoInstant = string;

/** ISO-8601 date (no time). */
export type IsoDate = string;

/** Stable record id with a typed prefix per family. */
export type VendorId = `ven_${string}`;
export type CatalogItemId = `cat_${string}`;
export type FrameworkAgreementId = `fra_${string}`;
export type RequisitionId = `req_${string}`;
export type RfqId = `rfq_${string}`;
export type BidId = `bid_${string}`;
export type PurchaseOrderId = `po_${string}`;
export type GoodsReceiptId = `gr_${string}`;
export type InvoiceId = `inv_${string}`;
export type BudgetId = `bud_${string}`;
export type ApprovalChainId = `apc_${string}`;

// ─────────────────────────────────────────────────────────────────────
// Vendor registry
// ─────────────────────────────────────────────────────────────────────

export const VENDOR_CATEGORIES = [
  'maintenance',
  'cleaning',
  'security',
  'IT',
  'legal',
  'medical',
  'landscaping',
  'plumbing',
  'electrical',
  'construction',
  'consumables',
  'office_supplies',
  'professional_services',
  'logistics',
  'utilities',
] as const;

export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

export const KYC_STATUSES = [
  'pending',
  'submitted',
  'approved',
  'rejected',
  'blocked',
] as const;

export type KycStatus = (typeof KYC_STATUSES)[number];

export const PREFERRED_STATUSES = [
  'preferred',
  'standard',
  'blacklisted',
] as const;

export type PreferredStatus = (typeof PREFERRED_STATUSES)[number];

/**
 * Bank details are stored encrypted at rest by the adapter. The type
 * carries the public-side accessor shape; serialisation to ciphertext
 * happens in the repo.
 */
export interface BankDetails {
  readonly bankName: string;
  readonly branch: string | null;
  readonly accountName: string;
  /** Encrypted at rest. The string in memory is plaintext only while
   *  the value transits from the form to the repo. */
  readonly accountNumber: string;
  readonly swiftCode: string | null;
}

export interface VendorCertification {
  readonly name: string;
  readonly issuer: string;
  readonly issuedAt: IsoDate;
  readonly expiresAt: IsoDate | null;
  readonly documentUrl: string | null;
}

export interface Vendor {
  readonly id: VendorId;
  readonly tenantId: string;
  readonly country: CountryCode;
  readonly companyName: string;
  readonly registrationNumber: string;
  readonly taxId: string;
  readonly kycStatus: KycStatus;
  readonly categories: ReadonlyArray<VendorCategory>;
  readonly bankDetails: BankDetails | null;
  readonly insuranceExpiresAt: IsoDate | null;
  readonly certifications: ReadonlyArray<VendorCertification>;
  /** 1-5; null until first delivery completes. */
  readonly rating: number | null;
  readonly preferredStatus: PreferredStatus;
  /** Free-form contact email used for PO issuance + RFQ invites. */
  readonly contactEmail: string;
  readonly contactPhone: string | null;
  readonly createdAt: IsoInstant;
  /** Last KYC decision timestamp — null until first approve/reject. */
  readonly kycDecidedAt: IsoInstant | null;
  /** Reason if rejected or blacklisted. */
  readonly statusReason: string | null;
}

export const KYC_DOCUMENT_TYPES = [
  'business_registration_certificate',
  'tax_compliance_certificate',
  'tax_pin_certificate',
  'bank_statement',
  'director_id',
  'insurance_certificate',
  'nca_registration',          // KE — National Construction Authority
  'brela_registration',        // TZ — Business Registrations and Licensing Agency
  'tra_tax_clearance',         // TZ — Tanzania Revenue Authority
  'kra_pin',                   // KE — Kenya Revenue Authority
  'ursb_registration',         // UG — Uganda Registration Services Bureau
  'rra_certificate',           // RW — Rwanda Revenue Authority
  'cac_certificate',           // NG — Corporate Affairs Commission
  'firs_tin',                  // NG — Federal Inland Revenue Service
  'professional_indemnity',
] as const;

export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[number];

export interface KycDocument {
  readonly id: string;
  readonly vendorId: VendorId;
  readonly type: KycDocumentType;
  readonly fileUrl: string;
  readonly uploadedAt: IsoInstant;
  /** Issuer/regulator-stamped expiry date if known. */
  readonly expiresAt: IsoDate | null;
}

/**
 * Per-jurisdiction KYC requirement table. The registrar enforces this
 * at `submitKyc()` — vendors below the bar stay in `pending` until
 * every required document is attached.
 */
export interface JurisdictionKycRequirements {
  readonly country: CountryCode;
  readonly jurisdictionName: string;
  readonly requiredDocuments: ReadonlyArray<KycDocumentType>;
  readonly optionalDocuments: ReadonlyArray<KycDocumentType>;
  readonly regulatorNotes: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Catalog + framework agreements
// ─────────────────────────────────────────────────────────────────────

export interface CatalogItem {
  readonly id: CatalogItemId;
  readonly vendorId: VendorId;
  readonly tenantId: string;
  readonly sku: string;
  readonly description: string;
  readonly unit: string;            // e.g. 'ea', 'kg', 'L', 'hour'
  readonly unitPrice: number;
  readonly currency: CurrencyCode;
  readonly minOrderQty: number;
  readonly leadTimeDays: number;
  readonly validUntil: IsoDate | null;
  readonly category: VendorCategory;
}

export interface FrameworkAgreementLineRate {
  readonly sku: string;
  readonly negotiatedUnitPrice: number;
  readonly currency: CurrencyCode;
}

export interface FrameworkAgreement {
  readonly id: FrameworkAgreementId;
  readonly tenantId: string;
  readonly vendorId: VendorId;
  readonly title: string;
  readonly startsAt: IsoDate;
  readonly expiresAt: IsoDate;
  readonly totalCap: number;
  readonly currency: CurrencyCode;
  readonly drawnDown: number;       // running total of PO commitments
  readonly lineRates: ReadonlyArray<FrameworkAgreementLineRate>;
  readonly status: 'active' | 'expired' | 'suspended' | 'closed';
}

export interface PriceQuote {
  readonly source: 'framework' | 'catalog';
  readonly sourceId: FrameworkAgreementId | CatalogItemId;
  readonly vendorId: VendorId;
  readonly sku: string;
  readonly unitPrice: number;
  readonly currency: CurrencyCode;
  readonly qty: number;
  readonly subtotal: number;
}

// ─────────────────────────────────────────────────────────────────────
// Requisitions + approval chain
// ─────────────────────────────────────────────────────────────────────

export const REQUISITION_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'converted_to_rfq',
  'converted_to_po',
  'cancelled',
] as const;

export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

export const REQUISITION_URGENCY = ['low', 'normal', 'high', 'emergency'] as const;
export type RequisitionUrgency = (typeof REQUISITION_URGENCY)[number];

export interface RequisitionItem {
  readonly sku: string | null;       // null for free-text items
  readonly description: string;
  readonly qty: number;
  readonly unit: string;
  readonly estimatedUnitPrice: number;
  readonly currency: CurrencyCode;
  readonly subtotal: number;
}

export interface Requisition {
  readonly id: RequisitionId;
  readonly tenantId: string;
  readonly requestedBy: string;
  readonly department: string | null;
  readonly propertyId: string | null;
  readonly items: ReadonlyArray<RequisitionItem>;
  readonly estimatedTotal: number;
  readonly currency: CurrencyCode;
  readonly justification: string;
  readonly urgency: RequisitionUrgency;
  readonly status: RequisitionStatus;
  readonly budgetId: BudgetId | null;
  readonly approvalChainId: ApprovalChainId | null;
  readonly createdAt: IsoInstant;
  readonly submittedAt: IsoInstant | null;
  readonly decidedAt: IsoInstant | null;
  /** Set when `status === 'converted_to_rfq'`. */
  readonly rfqId: RfqId | null;
  /** Set when `status === 'converted_to_po'` (single-vendor fast path). */
  readonly poId: PurchaseOrderId | null;
}

// ─────────────────────────────────────────────────────────────────────
// Approval chain (minimal engine scaffolded in the package — no
// existing engine reachable for direct dependency injection)
// ─────────────────────────────────────────────────────────────────────

export const APPROVAL_LEVELS = [
  'department',
  'finance',
  'executive',
  'board',
] as const;

export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number];

export const APPROVAL_DECISIONS = ['pending', 'approved', 'rejected', 'skipped'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export interface ApprovalThresholdRule {
  readonly minAmount: number;
  readonly maxAmount: number | null;       // null = open-ended
  readonly currency: CurrencyCode;
  /** Levels required, in order. */
  readonly requiredLevels: ReadonlyArray<ApprovalLevel>;
}

export interface ApprovalPolicy {
  readonly tenantId: string;
  readonly category: VendorCategory | 'all';
  readonly thresholds: ReadonlyArray<ApprovalThresholdRule>;
}

export interface ApprovalStep {
  readonly level: ApprovalLevel;
  readonly assignee: string | null;          // userId (resolved at submit)
  readonly decision: ApprovalDecision;
  readonly decidedAt: IsoInstant | null;
  readonly comment: string | null;
}

export interface ApprovalChain {
  readonly id: ApprovalChainId;
  readonly tenantId: string;
  readonly subjectKind: 'requisition' | 'po' | 'invoice_exception';
  readonly subjectId: string;
  readonly amount: number;
  readonly currency: CurrencyCode;
  readonly steps: ReadonlyArray<ApprovalStep>;
  readonly status: 'in_flight' | 'approved' | 'rejected';
  readonly createdAt: IsoInstant;
  readonly resolvedAt: IsoInstant | null;
}

// ─────────────────────────────────────────────────────────────────────
// RFQ / Tender
// ─────────────────────────────────────────────────────────────────────

export const RFQ_STATUSES = [
  'draft',
  'published',
  'closed',
  'awarded',
  'cancelled',
] as const;

export type RfqStatus = (typeof RFQ_STATUSES)[number];

export interface RfqLine {
  readonly sku: string | null;
  readonly description: string;
  readonly qty: number;
  readonly unit: string;
}

export interface Rfq {
  readonly id: RfqId;
  readonly tenantId: string;
  readonly requisitionId: RequisitionId;
  readonly scope: string;
  readonly items: ReadonlyArray<RfqLine>;
  readonly deliveryAddress: string;
  readonly dueDate: IsoDate;
  /** Either explicit vendor invite list or 'marketplace' for public publish. */
  readonly publishedTo: ReadonlyArray<VendorId> | 'marketplace';
  /** Sealed = bids hidden from other bidders until close. */
  readonly sealedBidding: boolean;
  readonly status: RfqStatus;
  readonly publishedAt: IsoInstant | null;
  readonly closedAt: IsoInstant | null;
  readonly awardedBidId: BidId | null;
  readonly currency: CurrencyCode;
}

export interface BidLine {
  readonly sku: string | null;
  readonly description: string;
  readonly qty: number;
  readonly unitPrice: number;
  readonly subtotal: number;
}

export const BID_STATUSES = [
  'sealed',         // sealed-bidding open
  'visible',        // unsealed or RFQ closed
  'withdrawn',
  'rejected',
  'awarded',
  'lost',
] as const;

export type BidStatus = (typeof BID_STATUSES)[number];

export interface Bid {
  readonly id: BidId;
  readonly rfqId: RfqId;
  readonly vendorId: VendorId;
  readonly lines: ReadonlyArray<BidLine>;
  readonly total: number;
  readonly currency: CurrencyCode;
  readonly deliveryDays: number;
  readonly validUntil: IsoDate;
  readonly notes: string | null;
  readonly status: BidStatus;
  readonly submittedAt: IsoInstant;
}

// ─────────────────────────────────────────────────────────────────────
// Purchase Order
// ─────────────────────────────────────────────────────────────────────

export const PO_STATUSES = [
  'pending_approval',
  'approved',
  'issued',
  'partially_received',
  'received',
  'cancelled',
  'closed',
] as const;

export type PoStatus = (typeof PO_STATUSES)[number];

export interface PoItem {
  readonly sku: string | null;
  readonly description: string;
  readonly qty: number;
  readonly unit: string;
  readonly unitPrice: number;
  readonly subtotal: number;
  readonly qtyReceived: number;
}

export interface PurchaseOrder {
  readonly id: PurchaseOrderId;
  readonly tenantId: string;
  readonly tenantSlug: string;            // for human PO number
  readonly poNumber: string;              // `<slug>-PO-<yyyy>-<seq>`
  readonly vendorId: VendorId;
  readonly requisitionId: RequisitionId | null;
  readonly rfqId: RfqId | null;
  readonly bidId: BidId | null;
  readonly frameworkAgreementId: FrameworkAgreementId | null;
  readonly items: ReadonlyArray<PoItem>;
  readonly total: number;
  readonly currency: CurrencyCode;
  readonly deliveryDate: IsoDate;
  readonly deliveryAddress: string;
  readonly paymentTerms: string;            // 'NET30', etc.
  readonly approvalChainId: ApprovalChainId | null;
  readonly status: PoStatus;
  readonly createdAt: IsoInstant;
  readonly issuedAt: IsoInstant | null;
  readonly cancelledAt: IsoInstant | null;
  readonly closedAt: IsoInstant | null;
  /** PDF URL once `@borjie/document-studio` renders. */
  readonly pdfUrl: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Goods Receipt
// ─────────────────────────────────────────────────────────────────────

export const RECEIPT_LINE_CONDITIONS = [
  'good',
  'damaged',
  'wrong_item',
  'short_shipped',
  'over_shipped',
] as const;

export type ReceiptLineCondition = (typeof RECEIPT_LINE_CONDITIONS)[number];

export interface ReceiptItem {
  readonly poItemSku: string | null;
  readonly description: string;
  readonly qtyReceived: number;
  readonly condition: ReceiptLineCondition;
  readonly photos: ReadonlyArray<string>;
  readonly notes: string | null;
}

export interface ReceiptDiscrepancy {
  readonly kind: 'qty_mismatch' | 'damaged' | 'wrong_item' | 'late_delivery';
  readonly poItemSku: string | null;
  readonly description: string;
  readonly severity: 'low' | 'medium' | 'high';
  readonly actionRequired: string;
}

export interface GoodsReceipt {
  readonly id: GoodsReceiptId;
  readonly tenantId: string;
  readonly poId: PurchaseOrderId;
  readonly receivedBy: string;
  readonly receivedAt: IsoInstant;
  readonly items: ReadonlyArray<ReceiptItem>;
  readonly discrepancies: ReadonlyArray<ReceiptDiscrepancy>;
  readonly notes: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Vendor invoice + 3-way match
// ─────────────────────────────────────────────────────────────────────

export const INVOICE_STATUSES = [
  'submitted',
  'matched',
  'exception',
  'approved_for_payment',
  'paid',
  'rejected',
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface InvoiceLine {
  readonly sku: string | null;
  readonly description: string;
  readonly qty: number;
  readonly unitPrice: number;
  readonly subtotal: number;
}

export interface VendorInvoice {
  readonly id: InvoiceId;
  readonly tenantId: string;
  readonly vendorId: VendorId;
  readonly poId: PurchaseOrderId;
  readonly invoiceNumber: string;
  readonly lineItems: ReadonlyArray<InvoiceLine>;
  readonly total: number;
  readonly currency: CurrencyCode;
  readonly issuedAt: IsoDate;
  readonly dueDate: IsoDate;
  readonly status: InvoiceStatus;
  readonly submittedAt: IsoInstant;
  /** Set when 3-way match flips to `exception`. */
  readonly exceptionReasons: ReadonlyArray<string>;
}

export interface ThreeWayMatchResult {
  readonly invoiceId: InvoiceId;
  readonly poId: PurchaseOrderId;
  readonly matched: boolean;
  readonly qtyMatched: boolean;
  readonly priceMatched: boolean;
  readonly totalsReconciled: boolean;
  readonly discrepancies: ReadonlyArray<string>;
  readonly recommendedAction: 'approve' | 'route_to_exception' | 'reject';
}

// ─────────────────────────────────────────────────────────────────────
// Budgets
// ─────────────────────────────────────────────────────────────────────

export const BUDGET_SCOPES = [
  'org',
  'department',
  'property',
  'category',
] as const;

export type BudgetScope = (typeof BUDGET_SCOPES)[number];

export const BUDGET_PERIODS = ['monthly', 'quarterly', 'annual'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export interface Budget {
  readonly id: BudgetId;
  readonly tenantId: string;
  readonly scope: BudgetScope;
  /** Concrete scope key (departmentId, propertyId, category, or 'org'). */
  readonly scopeKey: string;
  readonly period: BudgetPeriod;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly amount: number;
  readonly currency: CurrencyCode;
  /** Paid invoices total. */
  readonly spent: number;
  /** Issued POs not yet invoiced/paid. */
  readonly committed: number;
  /** Requisitions submitted but not yet approved/cancelled. */
  readonly reserved: number;
  readonly alertThresholdsPct: ReadonlyArray<number>;   // e.g. [80, 95, 100]
}

export interface BudgetAvailability {
  readonly budget: Budget;
  readonly available: number;
  readonly utilisationPct: number;
  readonly alertLevel: 'green' | 'amber' | 'red' | 'over';
}

// ─────────────────────────────────────────────────────────────────────
// Spend analytics
// ─────────────────────────────────────────────────────────────────────

export interface SpendByCategory {
  readonly category: VendorCategory;
  readonly amount: number;
  readonly currency: CurrencyCode;
  readonly poCount: number;
}

export interface SpendByVendor {
  readonly vendorId: VendorId;
  readonly vendorName: string;
  readonly amount: number;
  readonly currency: CurrencyCode;
  readonly poCount: number;
  readonly avgPoValue: number;
}

export interface VendorPerformance {
  readonly vendorId: VendorId;
  readonly vendorName: string;
  readonly onTimeDeliveryRate: number;       // 0-1
  readonly qualityScore: number;             // 0-1
  readonly avgPriceVsMarket: number;         // 1.0 = at market, <1 cheaper
  readonly complaintsCount: number;
  readonly ratingDecile: number;             // 1-10
}

export interface MaverickSpendItem {
  readonly poId: PurchaseOrderId;
  readonly vendorId: VendorId;
  readonly amount: number;
  readonly currency: CurrencyCode;
  readonly reason: 'outside_framework' | 'no_rfq' | 'single_bid_high_value';
  readonly suggestedAction: string;
}

// ─────────────────────────────────────────────────────────────────────
// Ports (injectable adapters)
// ─────────────────────────────────────────────────────────────────────

export interface ProcurementDataPort {
  /* Vendor CRUD */
  insertVendor(v: Vendor): Promise<void>;
  findVendor(id: VendorId): Promise<Vendor | null>;
  listVendors(tenantId: string): Promise<ReadonlyArray<Vendor>>;
  updateVendor(v: Vendor): Promise<void>;

  /* KYC */
  insertKycDocument(doc: KycDocument): Promise<void>;
  listKycDocuments(vendorId: VendorId): Promise<ReadonlyArray<KycDocument>>;

  /* Catalog + framework */
  insertCatalogItem(item: CatalogItem): Promise<void>;
  listCatalogItems(tenantId: string, vendorId?: VendorId): Promise<ReadonlyArray<CatalogItem>>;
  insertFrameworkAgreement(fa: FrameworkAgreement): Promise<void>;
  findFrameworkAgreement(id: FrameworkAgreementId): Promise<FrameworkAgreement | null>;
  listFrameworkAgreements(tenantId: string, vendorId?: VendorId): Promise<ReadonlyArray<FrameworkAgreement>>;
  updateFrameworkAgreement(fa: FrameworkAgreement): Promise<void>;

  /* Requisition */
  insertRequisition(r: Requisition): Promise<void>;
  findRequisition(id: RequisitionId): Promise<Requisition | null>;
  updateRequisition(r: Requisition): Promise<void>;
  listRequisitions(tenantId: string): Promise<ReadonlyArray<Requisition>>;

  /* Approval chain */
  insertApprovalChain(ac: ApprovalChain): Promise<void>;
  findApprovalChain(id: ApprovalChainId): Promise<ApprovalChain | null>;
  updateApprovalChain(ac: ApprovalChain): Promise<void>;
  upsertApprovalPolicy(p: ApprovalPolicy): Promise<void>;
  findApprovalPolicy(tenantId: string, category: VendorCategory | 'all'): Promise<ApprovalPolicy | null>;

  /* RFQ + bids */
  insertRfq(r: Rfq): Promise<void>;
  findRfq(id: RfqId): Promise<Rfq | null>;
  updateRfq(r: Rfq): Promise<void>;
  listRfqs(tenantId: string): Promise<ReadonlyArray<Rfq>>;
  insertBid(b: Bid): Promise<void>;
  findBid(id: BidId): Promise<Bid | null>;
  updateBid(b: Bid): Promise<void>;
  listBids(rfqId: RfqId): Promise<ReadonlyArray<Bid>>;

  /* PO */
  insertPo(po: PurchaseOrder): Promise<void>;
  findPo(id: PurchaseOrderId): Promise<PurchaseOrder | null>;
  updatePo(po: PurchaseOrder): Promise<void>;
  listPos(tenantId: string): Promise<ReadonlyArray<PurchaseOrder>>;
  nextPoSequence(tenantId: string, year: number): Promise<number>;

  /* Goods receipt */
  insertGoodsReceipt(gr: GoodsReceipt): Promise<void>;
  listGoodsReceiptsByPo(poId: PurchaseOrderId): Promise<ReadonlyArray<GoodsReceipt>>;

  /* Invoice */
  insertInvoice(inv: VendorInvoice): Promise<void>;
  findInvoice(id: InvoiceId): Promise<VendorInvoice | null>;
  updateInvoice(inv: VendorInvoice): Promise<void>;
  listInvoices(tenantId: string): Promise<ReadonlyArray<VendorInvoice>>;

  /* Budget */
  insertBudget(b: Budget): Promise<void>;
  findBudget(id: BudgetId): Promise<Budget | null>;
  updateBudget(b: Budget): Promise<void>;
  listBudgets(tenantId: string): Promise<ReadonlyArray<Budget>>;
}

export interface StoragePort {
  /** Upload a file blob and return a stable URL. */
  upload(args: {
    readonly tenantId: string;
    readonly path: string;
    readonly bytes: Uint8Array | string;
    readonly contentType: string;
  }): Promise<{ readonly url: string }>;
}

export interface DocumentStudioPort {
  /** Render a PO PDF via a template engine; returns the URL. */
  renderPoPdf(po: PurchaseOrder, vendor: Vendor): Promise<{ readonly url: string }>;
}

export interface ApprovalEnginePort {
  /** Resolve an approval chain for the given subject. The default
   *  implementation in this package consults the configured policy
   *  table; an external engine can override. */
  resolveChain(args: {
    readonly tenantId: string;
    readonly subjectKind: ApprovalChain['subjectKind'];
    readonly subjectId: string;
    readonly amount: number;
    readonly currency: CurrencyCode;
    readonly category: VendorCategory | 'all';
  }): Promise<ApprovalChain>;
  /** Record one approver's decision and advance the chain. */
  decide(args: {
    readonly chainId: ApprovalChainId;
    readonly level: ApprovalLevel;
    readonly decision: 'approved' | 'rejected';
    readonly assignee: string;
    readonly comment?: string;
  }): Promise<ApprovalChain>;
}

/** Clock port for deterministic tests. */
export interface ClockPort {
  now(): Date;
}

export const SYSTEM_CLOCK: ClockPort = Object.freeze({
  now(): Date {
    return new Date();
  },
});
