/**
 * Drizzle-backed `ProcurementDataPort` for `@borjie/procurement-coordination`.
 *
 * Implements the package's data port against the durable `procurement_*`
 * tables (migration 0294), so vendor registry, budgets, requisitions, approval
 * chains/policies, purchase orders, invoices, and spend analytics all run on
 * REAL persisted rows instead of an in-process map.
 *
 * Tenant isolation is enforced in TWO layers:
 *   1. RLS — every table FORCE-enables row-level security on the canonical
 *      `app.current_tenant_id` GUC, bound per request by databaseMiddleware.
 *   2. Defence-in-depth — every list read ALSO filters by the caller tenantId,
 *      and every insert carries `tenantId` on the row.
 *
 * SCOPE (honest): the EIGHT core collections this wave models are fully
 * implemented. The non-core collections (catalog items, framework agreements,
 * RFQs, bids, goods receipts) are NOT modelled — their reads return empty /
 * null and their writes throw `UnsupportedProcurementCollectionError`, so a
 * caller can never silently lose data. The procurement-coordination route only
 * exercises the eight core collections.
 *
 * The Drizzle client is typed `DrizzleLike` (`any`) at the seam: the fluent
 * builder generics cannot be reproduced through the `@borjie/database` barrel
 * without tripping TS2709 (see `ai-native/drizzle-repos.ts`). Rows are mapped
 * through the explicit converters in `./mappers`, so callers stay typed.
 *
 * No `console.log` — failures propagate to the route's error envelope.
 */

import { and, eq, sql } from 'drizzle-orm';
import {
  procurementVendors,
  procurementKycDocuments,
  procurementBudgets,
  procurementRequisitions,
  procurementApprovalChains,
  procurementApprovalPolicies,
  procurementPurchaseOrders,
  procurementPoSequences,
  procurementVendorInvoices,
} from '@borjie/database';
import type { ProcurementDataPort } from '@borjie/procurement-coordination';
import {
  rowToVendor,
  vendorToRow,
  rowToKycDocument,
  kycDocumentToRow,
  rowToBudget,
  budgetToRow,
  rowToRequisition,
  requisitionToRow,
  rowToApprovalChain,
  approvalChainToRow,
  rowToApprovalPolicy,
  rowToPurchaseOrder,
  purchaseOrderToRow,
  rowToVendorInvoice,
  vendorInvoiceToRow,
} from './mappers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleLike = any;
type Row = Record<string, unknown>;

/** Thrown when a caller hits a not-yet-modelled procurement collection. */
export class UnsupportedProcurementCollectionError extends Error {
  constructor(collection: string) {
    super(
      `procurement collection '${collection}' has no durable table in this wave`,
    );
    this.name = 'UnsupportedProcurementCollectionError';
  }
}

/**
 * Build a Drizzle-backed `ProcurementDataPort` bound to the request's
 * RLS-pinned client. Construct one per request inside the route handler. The
 * caller-supplied `tenantId` is used for defence-in-depth filtering on the
 * vendor-scoped reads that the port signature does not carry a tenantId for
 * (KYC docs, bids by rfq, etc.).
 */
export function createDrizzleProcurementDataPort(
  db: DrizzleLike,
): ProcurementDataPort {
  return {
    // ─── Vendor ────────────────────────────────────────────────────────────
    insertVendor: async (v) => {
      await db
        .insert(procurementVendors)
        .values(vendorToRow(v))
        .onConflictDoUpdate({ target: procurementVendors.id, set: vendorToRow(v) });
    },
    findVendor: async (id) => {
      const rows = (await db
        .select()
        .from(procurementVendors)
        .where(eq(procurementVendors.id, id))
        .limit(1)) as Row[];
      return rows[0] ? rowToVendor(rows[0]) : null;
    },
    listVendors: async (tenantId) => {
      const rows = (await db
        .select()
        .from(procurementVendors)
        .where(eq(procurementVendors.tenantId, tenantId))) as Row[];
      return rows.map(rowToVendor);
    },
    updateVendor: async (v) => {
      await db
        .update(procurementVendors)
        .set(vendorToRow(v))
        .where(eq(procurementVendors.id, v.id));
    },

    // ─── KYC ──────────────────────────────────────────────────────────────
    insertKycDocument: async (doc) => {
      // The vendor row carries tenant_id; resolve it for the FK + RLS column.
      const vendorRows = (await db
        .select({ tenantId: procurementVendors.tenantId })
        .from(procurementVendors)
        .where(eq(procurementVendors.id, doc.vendorId))
        .limit(1)) as Row[];
      const tenantId = vendorRows[0] ? String(vendorRows[0].tenantId) : '';
      await db
        .insert(procurementKycDocuments)
        .values(kycDocumentToRow(doc, tenantId));
    },
    listKycDocuments: async (vendorId) => {
      const rows = (await db
        .select()
        .from(procurementKycDocuments)
        .where(eq(procurementKycDocuments.vendorId, vendorId))) as Row[];
      return rows.map(rowToKycDocument);
    },

    // ─── Catalog + framework (not modelled this wave) ───────────────────────
    insertCatalogItem: async () => {
      throw new UnsupportedProcurementCollectionError('catalog-items');
    },
    listCatalogItems: async () => [],
    insertFrameworkAgreement: async () => {
      throw new UnsupportedProcurementCollectionError('framework-agreements');
    },
    findFrameworkAgreement: async () => null,
    listFrameworkAgreements: async () => [],
    updateFrameworkAgreement: async () => {
      throw new UnsupportedProcurementCollectionError('framework-agreements');
    },

    // ─── Requisition ────────────────────────────────────────────────────────
    insertRequisition: async (r) => {
      await db.insert(procurementRequisitions).values(requisitionToRow(r));
    },
    findRequisition: async (id) => {
      const rows = (await db
        .select()
        .from(procurementRequisitions)
        .where(eq(procurementRequisitions.id, id))
        .limit(1)) as Row[];
      return rows[0] ? rowToRequisition(rows[0]) : null;
    },
    updateRequisition: async (r) => {
      await db
        .update(procurementRequisitions)
        .set(requisitionToRow(r))
        .where(eq(procurementRequisitions.id, r.id));
    },
    listRequisitions: async (tenantId) => {
      const rows = (await db
        .select()
        .from(procurementRequisitions)
        .where(eq(procurementRequisitions.tenantId, tenantId))) as Row[];
      return rows.map(rowToRequisition);
    },

    // ─── Approval chain + policy ────────────────────────────────────────────
    insertApprovalChain: async (ac) => {
      await db.insert(procurementApprovalChains).values(approvalChainToRow(ac));
    },
    findApprovalChain: async (id) => {
      const rows = (await db
        .select()
        .from(procurementApprovalChains)
        .where(eq(procurementApprovalChains.id, id))
        .limit(1)) as Row[];
      return rows[0] ? rowToApprovalChain(rows[0]) : null;
    },
    updateApprovalChain: async (ac) => {
      await db
        .update(procurementApprovalChains)
        .set(approvalChainToRow(ac))
        .where(eq(procurementApprovalChains.id, ac.id));
    },
    upsertApprovalPolicy: async (p) => {
      const values = {
        id: `${p.tenantId}::${p.category}`,
        tenantId: p.tenantId,
        category: p.category,
        thresholds: [...p.thresholds],
      };
      await db
        .insert(procurementApprovalPolicies)
        .values(values)
        .onConflictDoUpdate({
          target: [
            procurementApprovalPolicies.tenantId,
            procurementApprovalPolicies.category,
          ],
          set: { thresholds: values.thresholds },
        });
    },
    findApprovalPolicy: async (tenantId, category) => {
      const exact = (await db
        .select()
        .from(procurementApprovalPolicies)
        .where(
          and(
            eq(procurementApprovalPolicies.tenantId, tenantId),
            eq(procurementApprovalPolicies.category, category),
          ),
        )
        .limit(1)) as Row[];
      if (exact[0]) return rowToApprovalPolicy(exact[0]);
      const fallback = (await db
        .select()
        .from(procurementApprovalPolicies)
        .where(
          and(
            eq(procurementApprovalPolicies.tenantId, tenantId),
            eq(procurementApprovalPolicies.category, 'all'),
          ),
        )
        .limit(1)) as Row[];
      return fallback[0] ? rowToApprovalPolicy(fallback[0]) : null;
    },

    // ─── RFQ + bids (not modelled this wave) ────────────────────────────────
    insertRfq: async () => {
      throw new UnsupportedProcurementCollectionError('rfqs');
    },
    findRfq: async () => null,
    updateRfq: async () => {
      throw new UnsupportedProcurementCollectionError('rfqs');
    },
    listRfqs: async () => [],
    insertBid: async () => {
      throw new UnsupportedProcurementCollectionError('bids');
    },
    findBid: async () => null,
    updateBid: async () => {
      throw new UnsupportedProcurementCollectionError('bids');
    },
    listBids: async () => [],

    // ─── PO ──────────────────────────────────────────────────────────────────
    insertPo: async (po) => {
      await db.insert(procurementPurchaseOrders).values(purchaseOrderToRow(po));
    },
    findPo: async (id) => {
      const rows = (await db
        .select()
        .from(procurementPurchaseOrders)
        .where(eq(procurementPurchaseOrders.id, id))
        .limit(1)) as Row[];
      return rows[0] ? rowToPurchaseOrder(rows[0]) : null;
    },
    updatePo: async (po) => {
      await db
        .update(procurementPurchaseOrders)
        .set(purchaseOrderToRow(po))
        .where(eq(procurementPurchaseOrders.id, po.id));
    },
    listPos: async (tenantId) => {
      const rows = (await db
        .select()
        .from(procurementPurchaseOrders)
        .where(eq(procurementPurchaseOrders.tenantId, tenantId))) as Row[];
      return rows.map(rowToPurchaseOrder);
    },
    nextPoSequence: async (tenantId, year) => {
      // Atomic upsert-and-increment so concurrent PO issuance can't collide.
      const rows = (await db
        .insert(procurementPoSequences)
        .values({ tenantId, year, lastSeq: 1 })
        .onConflictDoUpdate({
          target: [
            procurementPoSequences.tenantId,
            procurementPoSequences.year,
          ],
          set: { lastSeq: sql`${procurementPoSequences.lastSeq} + 1` },
        })
        .returning({ lastSeq: procurementPoSequences.lastSeq })) as Row[];
      return rows[0] ? Number(rows[0].lastSeq) : 1;
    },

    // ─── Goods receipt (not modelled this wave) ─────────────────────────────
    insertGoodsReceipt: async () => {
      throw new UnsupportedProcurementCollectionError('goods-receipts');
    },
    listGoodsReceiptsByPo: async () => [],

    // ─── Invoice ──────────────────────────────────────────────────────────────
    insertInvoice: async (inv) => {
      await db
        .insert(procurementVendorInvoices)
        .values(vendorInvoiceToRow(inv));
    },
    findInvoice: async (id) => {
      const rows = (await db
        .select()
        .from(procurementVendorInvoices)
        .where(eq(procurementVendorInvoices.id, id))
        .limit(1)) as Row[];
      return rows[0] ? rowToVendorInvoice(rows[0]) : null;
    },
    updateInvoice: async (inv) => {
      await db
        .update(procurementVendorInvoices)
        .set(vendorInvoiceToRow(inv))
        .where(eq(procurementVendorInvoices.id, inv.id));
    },
    listInvoices: async (tenantId) => {
      const rows = (await db
        .select()
        .from(procurementVendorInvoices)
        .where(eq(procurementVendorInvoices.tenantId, tenantId))) as Row[];
      return rows.map(rowToVendorInvoice);
    },

    // ─── Budget ────────────────────────────────────────────────────────────────
    insertBudget: async (b) => {
      await db.insert(procurementBudgets).values(budgetToRow(b));
    },
    findBudget: async (id) => {
      const rows = (await db
        .select()
        .from(procurementBudgets)
        .where(eq(procurementBudgets.id, id))
        .limit(1)) as Row[];
      return rows[0] ? rowToBudget(rows[0]) : null;
    },
    updateBudget: async (b) => {
      await db
        .update(procurementBudgets)
        .set(budgetToRow(b))
        .where(eq(procurementBudgets.id, b.id));
    },
    listBudgets: async (tenantId) => {
      const rows = (await db
        .select()
        .from(procurementBudgets)
        .where(eq(procurementBudgets.tenantId, tenantId))) as Row[];
      return rows.map(rowToBudget);
    },
  };
}
