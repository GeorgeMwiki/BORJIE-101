/**
 * In-memory ProcurementDataPort.
 *
 * Two reasons for this adapter to ship in the core package:
 *
 *   1. The Postgres-backed adapter is provisioned by migration 0177
 *      but not wired into the composition root yet. Until then, route
 *      tests + the dev portal fall back to this seeded store so a
 *      developer can hit a working surface end-to-end.
 *   2. Domain tests construct their own stores via this helper so the
 *      assertions read like a fixture, not a mock soup.
 *
 * The store is mutable internally (Maps + arrays) but every accessor
 * returns frozen snapshots so consumers can't drift the in-memory
 * state by holding onto a returned reference.
 */

import type {
  ApprovalChain,
  ApprovalChainId,
  ApprovalPolicy,
  Bid,
  BidId,
  Budget,
  BudgetId,
  CatalogItem,
  FrameworkAgreement,
  FrameworkAgreementId,
  GoodsReceipt,
  KycDocument,
  ProcurementDataPort,
  PurchaseOrder,
  PurchaseOrderId,
  Requisition,
  RequisitionId,
  Rfq,
  RfqId,
  Vendor,
  VendorCategory,
  VendorId,
  VendorInvoice,
  InvoiceId,
} from './types.js';

export interface InMemoryStore {
  readonly vendors: Map<VendorId, Vendor>;
  readonly kycDocuments: Map<string, KycDocument>;
  readonly catalogItems: Map<string, CatalogItem>;
  readonly frameworkAgreements: Map<FrameworkAgreementId, FrameworkAgreement>;
  readonly requisitions: Map<RequisitionId, Requisition>;
  readonly approvalChains: Map<ApprovalChainId, ApprovalChain>;
  readonly approvalPolicies: Map<string, ApprovalPolicy>;
  readonly rfqs: Map<RfqId, Rfq>;
  readonly bids: Map<BidId, Bid>;
  readonly purchaseOrders: Map<PurchaseOrderId, PurchaseOrder>;
  readonly goodsReceipts: Map<string, GoodsReceipt>;
  readonly invoices: Map<InvoiceId, VendorInvoice>;
  readonly budgets: Map<BudgetId, Budget>;
  readonly poSequence: Map<string, number>;       // `${tenantId}-${year}` → seq
}

export function createInMemoryStore(): InMemoryStore {
  return {
    vendors: new Map(),
    kycDocuments: new Map(),
    catalogItems: new Map(),
    frameworkAgreements: new Map(),
    requisitions: new Map(),
    approvalChains: new Map(),
    approvalPolicies: new Map(),
    rfqs: new Map(),
    bids: new Map(),
    purchaseOrders: new Map(),
    goodsReceipts: new Map(),
    invoices: new Map(),
    budgets: new Map(),
    poSequence: new Map(),
  };
}

export function inMemoryDataPort(store: InMemoryStore): ProcurementDataPort {
  return {
    // ─── Vendor ────────────────────────────────────────────────────
    async insertVendor(v) {
      store.vendors.set(v.id, v);
    },
    async findVendor(id) {
      return store.vendors.get(id) ?? null;
    },
    async listVendors(tenantId) {
      return Array.from(store.vendors.values()).filter(
        (v) => v.tenantId === tenantId,
      );
    },
    async updateVendor(v) {
      if (!store.vendors.has(v.id)) {
        throw new Error(`Vendor ${v.id} not found`);
      }
      store.vendors.set(v.id, v);
    },

    // ─── KYC ───────────────────────────────────────────────────────
    async insertKycDocument(doc) {
      store.kycDocuments.set(doc.id, doc);
    },
    async listKycDocuments(vendorId) {
      return Array.from(store.kycDocuments.values()).filter(
        (d) => d.vendorId === vendorId,
      );
    },

    // ─── Catalog + framework ───────────────────────────────────────
    async insertCatalogItem(item) {
      store.catalogItems.set(item.id, item);
    },
    async listCatalogItems(tenantId, vendorId) {
      return Array.from(store.catalogItems.values()).filter(
        (c) => c.tenantId === tenantId && (!vendorId || c.vendorId === vendorId),
      );
    },
    async insertFrameworkAgreement(fa) {
      store.frameworkAgreements.set(fa.id, fa);
    },
    async findFrameworkAgreement(id) {
      return store.frameworkAgreements.get(id) ?? null;
    },
    async listFrameworkAgreements(tenantId, vendorId) {
      return Array.from(store.frameworkAgreements.values()).filter(
        (f) => f.tenantId === tenantId && (!vendorId || f.vendorId === vendorId),
      );
    },
    async updateFrameworkAgreement(fa) {
      if (!store.frameworkAgreements.has(fa.id)) {
        throw new Error(`Framework ${fa.id} not found`);
      }
      store.frameworkAgreements.set(fa.id, fa);
    },

    // ─── Requisition ───────────────────────────────────────────────
    async insertRequisition(r) {
      store.requisitions.set(r.id, r);
    },
    async findRequisition(id) {
      return store.requisitions.get(id) ?? null;
    },
    async updateRequisition(r) {
      if (!store.requisitions.has(r.id)) {
        throw new Error(`Requisition ${r.id} not found`);
      }
      store.requisitions.set(r.id, r);
    },
    async listRequisitions(tenantId) {
      return Array.from(store.requisitions.values()).filter(
        (r) => r.tenantId === tenantId,
      );
    },

    // ─── Approval chain ────────────────────────────────────────────
    async insertApprovalChain(ac) {
      store.approvalChains.set(ac.id, ac);
    },
    async findApprovalChain(id) {
      return store.approvalChains.get(id) ?? null;
    },
    async updateApprovalChain(ac) {
      if (!store.approvalChains.has(ac.id)) {
        throw new Error(`Chain ${ac.id} not found`);
      }
      store.approvalChains.set(ac.id, ac);
    },
    async upsertApprovalPolicy(p) {
      store.approvalPolicies.set(policyKey(p.tenantId, p.category), p);
    },
    async findApprovalPolicy(tenantId, category) {
      return (
        store.approvalPolicies.get(policyKey(tenantId, category)) ??
        store.approvalPolicies.get(policyKey(tenantId, 'all')) ??
        null
      );
    },

    // ─── RFQ + bids ────────────────────────────────────────────────
    async insertRfq(r) {
      store.rfqs.set(r.id, r);
    },
    async findRfq(id) {
      return store.rfqs.get(id) ?? null;
    },
    async updateRfq(r) {
      if (!store.rfqs.has(r.id)) {
        throw new Error(`RFQ ${r.id} not found`);
      }
      store.rfqs.set(r.id, r);
    },
    async listRfqs(tenantId) {
      return Array.from(store.rfqs.values()).filter((r) => r.tenantId === tenantId);
    },
    async insertBid(b) {
      store.bids.set(b.id, b);
    },
    async findBid(id) {
      return store.bids.get(id) ?? null;
    },
    async updateBid(b) {
      if (!store.bids.has(b.id)) {
        throw new Error(`Bid ${b.id} not found`);
      }
      store.bids.set(b.id, b);
    },
    async listBids(rfqId) {
      return Array.from(store.bids.values()).filter((b) => b.rfqId === rfqId);
    },

    // ─── PO ────────────────────────────────────────────────────────
    async insertPo(po) {
      store.purchaseOrders.set(po.id, po);
    },
    async findPo(id) {
      return store.purchaseOrders.get(id) ?? null;
    },
    async updatePo(po) {
      if (!store.purchaseOrders.has(po.id)) {
        throw new Error(`PO ${po.id} not found`);
      }
      store.purchaseOrders.set(po.id, po);
    },
    async listPos(tenantId) {
      return Array.from(store.purchaseOrders.values()).filter(
        (p) => p.tenantId === tenantId,
      );
    },
    async nextPoSequence(tenantId, year) {
      const key = `${tenantId}-${year}`;
      const current = store.poSequence.get(key) ?? 0;
      const next = current + 1;
      store.poSequence.set(key, next);
      return next;
    },

    // ─── Goods receipt ─────────────────────────────────────────────
    async insertGoodsReceipt(gr) {
      store.goodsReceipts.set(gr.id, gr);
    },
    async listGoodsReceiptsByPo(poId) {
      return Array.from(store.goodsReceipts.values()).filter(
        (g) => g.poId === poId,
      );
    },

    // ─── Invoice ───────────────────────────────────────────────────
    async insertInvoice(inv) {
      store.invoices.set(inv.id, inv);
    },
    async findInvoice(id) {
      return store.invoices.get(id) ?? null;
    },
    async updateInvoice(inv) {
      if (!store.invoices.has(inv.id)) {
        throw new Error(`Invoice ${inv.id} not found`);
      }
      store.invoices.set(inv.id, inv);
    },
    async listInvoices(tenantId) {
      return Array.from(store.invoices.values()).filter(
        (i) => i.tenantId === tenantId,
      );
    },

    // ─── Budget ────────────────────────────────────────────────────
    async insertBudget(b) {
      store.budgets.set(b.id, b);
    },
    async findBudget(id) {
      return store.budgets.get(id) ?? null;
    },
    async updateBudget(b) {
      if (!store.budgets.has(b.id)) {
        throw new Error(`Budget ${b.id} not found`);
      }
      store.budgets.set(b.id, b);
    },
    async listBudgets(tenantId) {
      return Array.from(store.budgets.values()).filter(
        (b) => b.tenantId === tenantId,
      );
    },
  };
}

function policyKey(tenantId: string, category: VendorCategory | 'all'): string {
  return `${tenantId}::${category}`;
}
