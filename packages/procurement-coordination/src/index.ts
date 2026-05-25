/**
 * `@borjie/procurement-coordination` — public surface.
 *
 * Composed of focused services (vendor registry, catalog, requisitions,
 * RFQ, PO, goods receipts, invoices, budgets, analytics) plus an
 * in-package approval engine. The composition root binds the data /
 * storage / document-studio ports; tests construct the in-memory
 * adapters from this file directly.
 *
 * Usage:
 *
 *   const store = createInMemoryStore();
 *   const dataPort = inMemoryDataPort(store);
 *   const platform = createProcurementCoordination({
 *     dataPort,
 *     storage: myStoragePort,
 *     documentStudio: myDocumentStudio,
 *   });
 *
 *   await platform.vendors.registerVendor({ ... });
 *   await platform.requisitions.createRequisition({ ... });
 */

// ─── Types ─────────────────────────────────────────────────────────
export * from './types.js';

// ─── In-memory adapter (test fixture + dev fallback) ───────────────
export {
  createInMemoryStore,
  inMemoryDataPort,
  type InMemoryStore,
} from './in-memory-data-port.js';

// ─── Vendor registry ───────────────────────────────────────────────
export {
  createVendorRegistry,
  type VendorRegistry,
  type VendorRegistryDeps,
  type RegisterVendorInput,
} from './vendors/vendor-registry.js';
export {
  JURISDICTION_KYC,
  kycRequirementsFor,
  supportedKycJurisdictions,
} from './vendors/jurisdictions.js';

// ─── Catalog + framework ───────────────────────────────────────────
export {
  createCatalogService,
  type CatalogService,
  type CatalogServiceDeps,
} from './catalog/catalog.js';

// ─── Approval engine ───────────────────────────────────────────────
export {
  createApprovalEngine,
  defaultApprovalPolicy,
  DEFAULT_THRESHOLDS,
  nextPendingLevel,
  type ApprovalEngineDeps,
} from './approvals/approval-engine.js';

// ─── Requisitions ──────────────────────────────────────────────────
export {
  createRequisitionsService,
  applyApprovalOutcome,
  type RequisitionsService,
  type RequisitionsServiceDeps,
  type CreateRequisitionInput,
} from './requisitions/requisitions.js';

// ─── RFQ / Tender ──────────────────────────────────────────────────
export {
  createRfqService,
  poSkeletonFromBid,
  type RfqService,
  type RfqServiceDeps,
  type PoSkeletonFromBid,
} from './rfq/rfq.js';

// ─── Purchase Orders ───────────────────────────────────────────────
export {
  createPurchaseOrderService,
  type PurchaseOrderService,
  type PurchaseOrderServiceDeps,
} from './po/purchase-orders.js';

// ─── Goods receipts ────────────────────────────────────────────────
export {
  createGoodsReceiptService,
  type GoodsReceiptService,
  type GoodsReceiptServiceDeps,
} from './receipts/goods-receipts.js';

// ─── Invoices + 3-way match ────────────────────────────────────────
export {
  createInvoiceService,
  type InvoiceService,
  type InvoiceServiceDeps,
} from './invoices/invoices.js';

// ─── Budgets ───────────────────────────────────────────────────────
export {
  createBudgetService,
  computeAvailability,
  type BudgetService,
  type BudgetServiceDeps,
} from './budgets/budgets.js';

// ─── Spend analytics ───────────────────────────────────────────────
export {
  createSpendAnalytics,
  type SpendAnalyticsService,
  type SpendAnalyticsDeps,
} from './analytics/spend-analytics.js';

// ─── Composite factory ─────────────────────────────────────────────

import type {
  ApprovalEnginePort,
  ClockPort,
  DocumentStudioPort,
  ProcurementDataPort,
  StoragePort,
} from './types.js';
import { createApprovalEngine as _createApprovalEngine } from './approvals/approval-engine.js';
import {
  createBudgetService as _createBudgetService,
  type BudgetService as _BudgetService,
} from './budgets/budgets.js';
import {
  createCatalogService as _createCatalogService,
  type CatalogService as _CatalogService,
} from './catalog/catalog.js';
import {
  createGoodsReceiptService as _createGoodsReceiptService,
  type GoodsReceiptService as _GoodsReceiptService,
} from './receipts/goods-receipts.js';
import {
  createInvoiceService as _createInvoiceService,
  type InvoiceService as _InvoiceService,
} from './invoices/invoices.js';
import {
  createPurchaseOrderService as _createPurchaseOrderService,
  type PurchaseOrderService as _PurchaseOrderService,
} from './po/purchase-orders.js';
import {
  createRequisitionsService as _createRequisitionsService,
  type RequisitionsService as _RequisitionsService,
} from './requisitions/requisitions.js';
import {
  createRfqService as _createRfqService,
  type RfqService as _RfqService,
} from './rfq/rfq.js';
import {
  createSpendAnalytics as _createSpendAnalytics,
  type SpendAnalyticsService as _SpendAnalyticsService,
} from './analytics/spend-analytics.js';
import {
  createVendorRegistry as _createVendorRegistry,
  type VendorRegistry as _VendorRegistry,
} from './vendors/vendor-registry.js';

export interface ProcurementCoordinationOptions {
  readonly dataPort: ProcurementDataPort;
  readonly storage?: StoragePort;
  readonly documentStudio?: DocumentStudioPort;
  /** Override the default in-package approval engine. */
  readonly approvalEngine?: ApprovalEnginePort;
  readonly clock?: ClockPort;
  readonly idFactory?: () => string;
  readonly blockOnOverBudget?: boolean;
}

export interface ProcurementCoordination {
  readonly vendors: _VendorRegistry;
  readonly catalog: _CatalogService;
  readonly approvalEngine: ApprovalEnginePort;
  readonly requisitions: _RequisitionsService;
  readonly rfq: _RfqService;
  readonly purchaseOrders: _PurchaseOrderService;
  readonly receipts: _GoodsReceiptService;
  readonly invoices: _InvoiceService;
  readonly budgets: _BudgetService;
  readonly analytics: _SpendAnalyticsService;
  readonly storage: StoragePort | null;
  readonly documentStudio: DocumentStudioPort | null;
}

export function createProcurementCoordination(
  opts: ProcurementCoordinationOptions,
): ProcurementCoordination {
  const { dataPort, clock, idFactory } = opts;
  const approvalEngine =
    opts.approvalEngine ?? _createApprovalEngine({ dataPort, ...(clock ? { clock } : {}), ...(idFactory ? { idFactory } : {}) });
  const baseDeps = {
    dataPort,
    ...(clock ? { clock } : {}),
    ...(idFactory ? { idFactory } : {}),
  };
  return {
    vendors: _createVendorRegistry(baseDeps),
    catalog: _createCatalogService(baseDeps),
    approvalEngine,
    requisitions: _createRequisitionsService({
      ...baseDeps,
      approvalEngine,
      ...(opts.blockOnOverBudget !== undefined ? { blockOnOverBudget: opts.blockOnOverBudget } : {}),
    }),
    rfq: _createRfqService(baseDeps),
    purchaseOrders: _createPurchaseOrderService({
      ...baseDeps,
      approvalEngine,
      ...(opts.documentStudio ? { documentStudio: opts.documentStudio } : {}),
    }),
    receipts: _createGoodsReceiptService(baseDeps),
    invoices: _createInvoiceService(baseDeps),
    budgets: _createBudgetService(baseDeps),
    analytics: _createSpendAnalytics({ dataPort }),
    storage: opts.storage ?? null,
    documentStudio: opts.documentStudio ?? null,
  };
}
