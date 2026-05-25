/**
 * `@borjie/inventory-management` — public surface.
 *
 * Estate-org inventory: SKU catalog, hierarchical stock locations,
 * append-only stock movements (receipts/issues/transfers/adjustments),
 * reorder + ABC analysis, cycle counts with variance-driven adjustments,
 * full asset lifecycle for `isAsset=true` SKUs (install in unit →
 * maintain → decommission), barcode/QR lookup, and inventory analytics.
 *
 * Pure functions everywhere; persistence is pushed to the orchestrator
 * via the `createInventoryManagement` factory which accepts optional
 * adapters for `procurement-coordination` (P24 — graceful when absent)
 * and `document-studio` (label PDF rendering).
 */

// Types
import { logger } from './logger.js';
export * from './types.js';

// SKU + catalog
export {
  bulkImportSkus,
  buildCategoryTree,
  createCategory,
  createSku,
  archiveSku,
  findSku,
  findSkuByCode,
  listSkus,
  SkuDraftSchema,
  SkuImportRowSchema,
  updateSku,
  type BulkImportResult,
  type CategoryNode,
  type SkuDraft,
} from './sku/sku-catalog.js';

// Locations
export {
  ancestorsOf,
  buildLocationTree,
  createLocation,
  defaultPropertyLocation,
  descendantsOf,
  findLocation,
  listLocations,
  LocationDraftSchema,
  type LocationDraft,
  type LocationNode,
} from './locations/stock-locations.js';

// Stock items (read views over the movement log)
export {
  onHandFor,
  serialsForSku,
  snapshotStockItems,
  totalOnHandForSku,
  type StockItemView,
} from './items/stock-items.js';

// Movements (append-only log + verb wrappers)
export {
  adjustStock,
  allBalances,
  appendMovement,
  currentStock,
  issueStock,
  movementHistory,
  MovementDraftSchema,
  receiveStock,
  transferStock,
  type MovementDraft,
  type StockBalance,
} from './movements/stock-movements.js';

// Reorder + ABC + replenishment
export {
  abcBand,
  forecastReorderDate,
  reorderCandidates,
  suggestPurchaseOrder,
  type ReorderCandidateOptions,
} from './reorder/reorder-engine.js';

// Cycle counts
export {
  closeCycleCount,
  recordCount,
  sampleSkusForCount,
  scheduleCycleCount,
  startCycleCount,
  type CloseResult,
} from './cycle-counts/cycle-counts.js';

// Assets
export {
  applianceInventoryForUnit,
  assetHistory,
  assetMaintenanceLog,
  assetSummaryForSku,
  AssetRegisterDraftSchema,
  findAssetBySerial,
  InstallAssetSchema,
  installAsset,
  logAssetMaintenance,
  MaintenanceLogSchema,
  registerAsset,
  RemoveAssetSchema,
  removeAsset,
  warrantyAlerts,
  type AssetRegisterDraft,
  type InstallAssetInput,
  type InstallResult,
  type MaintenanceLogInput,
  type RemoveAssetInput,
  type RemoveResult,
} from './assets/asset-tracking.js';

// Barcode / QR
export {
  bulkLabelHtml,
  lookupByCode,
  QR_PROTOCOL,
  qrCodeForAsset,
  qrCodeForSku,
  type LabelRow,
  type LookupResult,
} from './barcode/barcode.js';

// Analytics
export {
  consumptionHotspots,
  deadStockReport,
  inventoryTurnover,
  shrinkageReport,
  stockOnHandValue,
  stockOutIncidents,
} from './analytics/inventory-analytics.js';

// ─────────────────────────────────────────────────────────────────────
// Orchestrator — `createInventoryManagement` factory.
//
// Mirrors the sustainability-advisor shape: the package is a bag of
// pure functions, but a caller can wire it once at composition root
// and use a service object with persistence + optional adapters.
// ─────────────────────────────────────────────────────────────────────

import type {
  AssetEvent,
  AssetSerial,
  CycleCount,
  POSpec,
  ReorderCandidate,
  Sku,
  SkuCategory,
  StockLocation,
  StockMovement,
  TenantId,
} from './types.js';
import { reorderCandidates as reorderCandidatesImpl, suggestPurchaseOrder as suggestPurchaseOrderImpl } from './reorder/reorder-engine.js';

/**
 * Persistence port — caller supplies fetch + persist hooks for each
 * collection. Reads return the full per-tenant collection (the package
 * does in-memory filtering); writes are append-only for the log and
 * upsert-by-id for the rest.
 */
export interface InventoryStore {
  readonly loadSkus: (tenantId: TenantId) => Promise<ReadonlyArray<Sku>>;
  readonly loadCategories: (tenantId: TenantId) => Promise<ReadonlyArray<SkuCategory>>;
  readonly loadLocations: (tenantId: TenantId) => Promise<ReadonlyArray<StockLocation>>;
  readonly loadMovements: (tenantId: TenantId) => Promise<ReadonlyArray<StockMovement>>;
  readonly loadAssets: (tenantId: TenantId) => Promise<ReadonlyArray<AssetSerial>>;
  readonly loadAssetEvents: (tenantId: TenantId) => Promise<ReadonlyArray<AssetEvent>>;
  readonly loadCycleCounts: (tenantId: TenantId) => Promise<ReadonlyArray<CycleCount>>;
  readonly persistSku: (sku: Sku) => Promise<void>;
  readonly persistCategory: (category: SkuCategory) => Promise<void>;
  readonly persistLocation: (location: StockLocation) => Promise<void>;
  readonly persistMovement: (movement: StockMovement) => Promise<void>;
  readonly persistAsset: (asset: AssetSerial) => Promise<void>;
  readonly persistAssetEvent: (event: AssetEvent) => Promise<void>;
  readonly persistCycleCount: (count: CycleCount) => Promise<void>;
}

/**
 * Optional procurement-coordination adapter (P24, concurrent). When
 * provided, `suggestPurchaseOrder` will also emit a draft PO into the
 * procurement workflow. When absent, the orchestrator returns the
 * `POSpec` for the caller to handle.
 */
export interface ProcurementAdapter {
  readonly createDraftPO: (spec: POSpec) => Promise<{ readonly poId: string }>;
}

/**
 * Optional document-studio adapter — renders a label sheet to PDF.
 * When absent, the HTML fallback from `bulkLabelHtml` is used.
 */
export interface DocumentStudioAdapter {
  readonly renderLabelsPdf: (html: string) => Promise<Uint8Array>;
}

export interface InventoryManagementServices {
  readonly procurement: ProcurementAdapter | null;
  readonly documentStudio: DocumentStudioAdapter | null;
}

export interface ReorderWithPurchaseOrderResult {
  readonly candidates: ReadonlyArray<ReorderCandidate>;
  readonly specs: ReadonlyArray<POSpec>;
  readonly poIds: ReadonlyArray<string>;
  readonly procurementAttempted: boolean;
}

export interface InventoryManagement {
  /** Reorder + (optional) procurement hand-off in one call. */
  readonly reorderWithPurchaseOrder: (
    tenantId: TenantId,
    options?: { readonly locationId?: string; readonly createDraft?: boolean },
  ) => Promise<ReorderWithPurchaseOrderResult>;
  /** Adapters exposed for advanced callers. */
  readonly services: InventoryManagementServices;
  /** Underlying store, exposed for advanced read flows. */
  readonly store: InventoryStore;
}

/**
 * Build an inventory-management service object. Persistence + optional
 * adapters are injected here — the rest of the API surface stays as
 * pure functions.
 *
 * The factory does NOT mutate any of the input objects. All higher-
 * order pure functions (createSku, installAsset, etc.) are exported
 * separately and remain usable independently of the orchestrator.
 */
export function createInventoryManagement(deps: {
  readonly store: InventoryStore;
  readonly procurement?: ProcurementAdapter | null;
  readonly documentStudio?: DocumentStudioAdapter | null;
}): InventoryManagement {
  const services: InventoryManagementServices = {
    procurement: deps.procurement ?? null,
    documentStudio: deps.documentStudio ?? null,
  };
  return {
    services,
    store: deps.store,
    reorderWithPurchaseOrder: async (
      tenantId,
      options = {},
    ): Promise<ReorderWithPurchaseOrderResult> => {
      const [skus, log] = await Promise.all([
        deps.store.loadSkus(tenantId),
        deps.store.loadMovements(tenantId),
      ]);
      const candidates = reorderCandidatesImpl(
        skus,
        log,
        tenantId,
        options.locationId ? { locationId: options.locationId } : {},
      );
      const specs = suggestPurchaseOrderImpl(candidates, skus, tenantId);
      let poIds: string[] = [];
      let procurementAttempted = false;
      if (options.createDraft && services.procurement) {
        procurementAttempted = true;
        for (const spec of specs) {
          try {
            const r = await services.procurement.createDraftPO(spec);
            poIds.push(r.poId);
          } catch (e) {
            // Graceful — record nothing, leave caller to retry.
            logger.error('inventory.reorder: procurement adapter failed', { error: e });
          }
        }
      }
      return { candidates, specs, poIds, procurementAttempted };
    },
  };
}
