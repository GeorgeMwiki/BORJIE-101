/**
 * Row ↔ domain mappers for the Drizzle `ProcurementDataPort`.
 *
 * Converts persisted `procurement_*` rows into the `@borjie/procurement-
 * coordination` domain types and back. Kept separate from the port so the
 * port file stays focused on the query plumbing (both stay well under the
 * 800-line ceiling).
 *
 * Money: amounts persist as `numeric` (returned by the driver as a string)
 * and are parsed back to `number`; the sibling `currency` column carries the
 * ISO-4217 code. No currency literal is ever introduced here.
 *
 * jsonb columns are stored exactly as the domain value object, so they round-
 * trip with a single cast.
 */

import type {
  ApprovalChain,
  ApprovalPolicy,
  Budget,
  KycDocument,
  PurchaseOrder,
  Requisition,
  Vendor,
  VendorInvoice,
} from '@borjie/procurement-coordination';

type Row = Record<string, unknown>;

/** numeric/string → number (finite, defaulting to 0). */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** numeric/string → number | null (preserves a genuine null, e.g. rating). */
export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return iso(value);
}

function arr<T>(value: unknown): ReadonlyArray<T> {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Coerce a persisted id column to its prefixed branded id type. The domain
 * ids are template-literal string types (`ven_${string}`, `bud_${string}`,
 * …); the data-port only ever writes already-prefixed ids, so the runtime
 * value conforms — TS just can't prove it through `String(...)`.
 */
function brandedId<T extends string>(value: unknown): T {
  return String(value) as T;
}

// ── Vendor ────────────────────────────────────────────────────────────────

export function rowToVendor(r: Row): Vendor {
  return {
    id: brandedId<Vendor['id']>(r.id),
    tenantId: String(r.tenantId),
    country: String(r.country),
    companyName: String(r.companyName),
    registrationNumber: String(r.registrationNumber ?? ''),
    taxId: String(r.taxId ?? ''),
    kycStatus: String(r.kycStatus) as Vendor['kycStatus'],
    categories: arr<Vendor['categories'][number]>(r.categories),
    bankDetails: (r.bankDetails as Vendor['bankDetails']) ?? null,
    insuranceExpiresAt: r.insuranceExpiresAt
      ? String(r.insuranceExpiresAt)
      : null,
    certifications: arr<Vendor['certifications'][number]>(r.certifications),
    rating: numOrNull(r.rating),
    preferredStatus: String(r.preferredStatus) as Vendor['preferredStatus'],
    contactEmail: String(r.contactEmail ?? ''),
    contactPhone: r.contactPhone ? String(r.contactPhone) : null,
    createdAt: iso(r.createdAt),
    kycDecidedAt: isoOrNull(r.kycDecidedAt),
    statusReason: r.statusReason ? String(r.statusReason) : null,
  };
}

export function vendorToRow(v: Vendor): Row {
  return {
    id: v.id,
    tenantId: v.tenantId,
    country: v.country,
    companyName: v.companyName,
    registrationNumber: v.registrationNumber,
    taxId: v.taxId,
    kycStatus: v.kycStatus,
    categories: [...v.categories],
    bankDetails: v.bankDetails ?? null,
    insuranceExpiresAt: v.insuranceExpiresAt ?? null,
    certifications: [...v.certifications],
    rating: v.rating === null ? null : String(v.rating),
    preferredStatus: v.preferredStatus,
    contactEmail: v.contactEmail,
    contactPhone: v.contactPhone ?? null,
    statusReason: v.statusReason ?? null,
    kycDecidedAt: v.kycDecidedAt ? new Date(v.kycDecidedAt) : null,
  };
}

// ── KYC document ────────────────────────────────────────────────────────────

export function rowToKycDocument(r: Row): KycDocument {
  // The full domain shape lives in `payload`; the typed columns are for
  // indexing / FK only.
  return (r.payload as KycDocument) ?? ({ id: String(r.id) } as KycDocument);
}

export function kycDocumentToRow(doc: KycDocument, tenantId: string): Row {
  const d = doc as unknown as Record<string, unknown>;
  return {
    id: doc.id,
    vendorId: doc.vendorId,
    tenantId,
    documentType: String(d.documentType ?? d.type ?? 'other'),
    fileUrl: String(d.fileUrl ?? d.url ?? ''),
    payload: doc,
  };
}

// ── Budget ────────────────────────────────────────────────────────────────

export function rowToBudget(r: Row): Budget {
  return {
    id: brandedId<Budget['id']>(r.id),
    tenantId: String(r.tenantId),
    scope: String(r.scope) as Budget['scope'],
    scopeKey: String(r.scopeKey),
    period: String(r.period) as Budget['period'],
    periodStart: String(r.periodStart),
    periodEnd: String(r.periodEnd),
    amount: num(r.amount),
    currency: String(r.currency),
    spent: num(r.spent),
    committed: num(r.committed),
    reserved: num(r.reserved),
    alertThresholdsPct: arr<number>(r.alertThresholdsPct),
  };
}

export function budgetToRow(b: Budget): Row {
  return {
    id: b.id,
    tenantId: b.tenantId,
    scope: b.scope,
    scopeKey: b.scopeKey,
    period: b.period,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    amount: String(b.amount),
    currency: b.currency,
    spent: String(b.spent),
    committed: String(b.committed),
    reserved: String(b.reserved),
    alertThresholdsPct: [...b.alertThresholdsPct],
  };
}

// ── Requisition ─────────────────────────────────────────────────────────────

export function rowToRequisition(r: Row): Requisition {
  return {
    id: brandedId<Requisition['id']>(r.id),
    tenantId: String(r.tenantId),
    requestedBy: String(r.requestedBy),
    department: r.department ? String(r.department) : null,
    propertyId: r.propertyId ? String(r.propertyId) : null,
    items: arr<Requisition['items'][number]>(r.items),
    estimatedTotal: num(r.estimatedTotal),
    currency: String(r.currency),
    justification: String(r.justification ?? ''),
    urgency: String(r.urgency) as Requisition['urgency'],
    status: String(r.status) as Requisition['status'],
    budgetId: r.budgetId ? (String(r.budgetId) as Requisition['budgetId']) : null,
    approvalChainId: r.approvalChainId
      ? (String(r.approvalChainId) as Requisition['approvalChainId'])
      : null,
    createdAt: iso(r.createdAt),
    submittedAt: isoOrNull(r.submittedAt),
    decidedAt: isoOrNull(r.decidedAt),
    rfqId: r.rfqId ? (String(r.rfqId) as Requisition['rfqId']) : null,
    poId: r.poId ? (String(r.poId) as Requisition['poId']) : null,
  };
}

export function requisitionToRow(r: Requisition): Row {
  return {
    id: r.id,
    tenantId: r.tenantId,
    requestedBy: r.requestedBy,
    department: r.department ?? null,
    propertyId: r.propertyId ?? null,
    items: [...r.items],
    estimatedTotal: String(r.estimatedTotal),
    currency: r.currency,
    justification: r.justification,
    urgency: r.urgency,
    status: r.status,
    budgetId: r.budgetId ?? null,
    approvalChainId: r.approvalChainId ?? null,
    rfqId: r.rfqId ?? null,
    poId: r.poId ?? null,
    submittedAt: r.submittedAt ? new Date(r.submittedAt) : null,
    decidedAt: r.decidedAt ? new Date(r.decidedAt) : null,
  };
}

// ── Approval chain ──────────────────────────────────────────────────────────

export function rowToApprovalChain(r: Row): ApprovalChain {
  return {
    id: brandedId<ApprovalChain['id']>(r.id),
    tenantId: String(r.tenantId),
    subjectKind: String(r.subjectKind) as ApprovalChain['subjectKind'],
    subjectId: String(r.subjectId),
    amount: num(r.amount),
    currency: String(r.currency),
    steps: arr<ApprovalChain['steps'][number]>(r.steps),
    status: String(r.status) as ApprovalChain['status'],
    createdAt: iso(r.createdAt),
    resolvedAt: isoOrNull(r.resolvedAt),
  };
}

export function approvalChainToRow(ac: ApprovalChain): Row {
  return {
    id: ac.id,
    tenantId: ac.tenantId,
    subjectKind: ac.subjectKind,
    subjectId: ac.subjectId,
    amount: String(ac.amount),
    currency: ac.currency,
    steps: [...ac.steps],
    status: ac.status,
    resolvedAt: ac.resolvedAt ? new Date(ac.resolvedAt) : null,
  };
}

// ── Approval policy ─────────────────────────────────────────────────────────

export function rowToApprovalPolicy(r: Row): ApprovalPolicy {
  return {
    tenantId: String(r.tenantId),
    category: String(r.category) as ApprovalPolicy['category'],
    thresholds: arr<ApprovalPolicy['thresholds'][number]>(r.thresholds),
  };
}

// ── Purchase order ──────────────────────────────────────────────────────────

export function rowToPurchaseOrder(r: Row): PurchaseOrder {
  return {
    id: brandedId<PurchaseOrder['id']>(r.id),
    tenantId: String(r.tenantId),
    tenantSlug: String(r.tenantSlug ?? ''),
    poNumber: String(r.poNumber),
    vendorId: String(r.vendorId) as PurchaseOrder['vendorId'],
    requisitionId: r.requisitionId
      ? (String(r.requisitionId) as PurchaseOrder['requisitionId'])
      : null,
    rfqId: r.rfqId ? (String(r.rfqId) as PurchaseOrder['rfqId']) : null,
    bidId: r.bidId ? (String(r.bidId) as PurchaseOrder['bidId']) : null,
    frameworkAgreementId: r.frameworkAgreementId
      ? (String(r.frameworkAgreementId) as PurchaseOrder['frameworkAgreementId'])
      : null,
    items: arr<PurchaseOrder['items'][number]>(r.items),
    total: num(r.total),
    currency: String(r.currency),
    deliveryDate: String(r.deliveryDate ?? ''),
    deliveryAddress: String(r.deliveryAddress ?? ''),
    paymentTerms: String(r.paymentTerms ?? ''),
    approvalChainId: r.approvalChainId
      ? (String(r.approvalChainId) as PurchaseOrder['approvalChainId'])
      : null,
    status: String(r.status) as PurchaseOrder['status'],
    createdAt: iso(r.createdAt),
    issuedAt: isoOrNull(r.issuedAt),
    cancelledAt: isoOrNull(r.cancelledAt),
    closedAt: isoOrNull(r.closedAt),
    pdfUrl: r.pdfUrl ? String(r.pdfUrl) : null,
  };
}

export function purchaseOrderToRow(po: PurchaseOrder): Row {
  return {
    id: po.id,
    tenantId: po.tenantId,
    tenantSlug: po.tenantSlug,
    poNumber: po.poNumber,
    vendorId: po.vendorId,
    requisitionId: po.requisitionId ?? null,
    rfqId: po.rfqId ?? null,
    bidId: po.bidId ?? null,
    frameworkAgreementId: po.frameworkAgreementId ?? null,
    items: [...po.items],
    total: String(po.total),
    currency: po.currency,
    deliveryDate: po.deliveryDate,
    deliveryAddress: po.deliveryAddress,
    paymentTerms: po.paymentTerms,
    approvalChainId: po.approvalChainId ?? null,
    status: po.status,
    pdfUrl: po.pdfUrl ?? null,
    issuedAt: po.issuedAt ? new Date(po.issuedAt) : null,
    cancelledAt: po.cancelledAt ? new Date(po.cancelledAt) : null,
    closedAt: po.closedAt ? new Date(po.closedAt) : null,
  };
}

// ── Vendor invoice ──────────────────────────────────────────────────────────

export function rowToVendorInvoice(r: Row): VendorInvoice {
  return {
    id: brandedId<VendorInvoice['id']>(r.id),
    tenantId: String(r.tenantId),
    vendorId: String(r.vendorId) as VendorInvoice['vendorId'],
    poId: String(r.poId) as VendorInvoice['poId'],
    invoiceNumber: String(r.invoiceNumber),
    lineItems: arr<VendorInvoice['lineItems'][number]>(r.lineItems),
    total: num(r.total),
    currency: String(r.currency),
    issuedAt: String(r.issuedAt ?? ''),
    dueDate: String(r.dueDate ?? ''),
    status: String(r.status) as VendorInvoice['status'],
    submittedAt: iso(r.submittedAt),
    exceptionReasons: arr<string>(r.exceptionReasons),
  };
}

export function vendorInvoiceToRow(inv: VendorInvoice): Row {
  return {
    id: inv.id,
    tenantId: inv.tenantId,
    vendorId: inv.vendorId,
    poId: inv.poId,
    invoiceNumber: inv.invoiceNumber,
    lineItems: [...inv.lineItems],
    total: String(inv.total),
    currency: inv.currency,
    issuedAt: inv.issuedAt,
    dueDate: inv.dueDate,
    status: inv.status,
    exceptionReasons: [...inv.exceptionReasons],
    submittedAt: inv.submittedAt ? new Date(inv.submittedAt) : new Date(),
  };
}
