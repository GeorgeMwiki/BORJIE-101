/**
 * Warehouse Inventory Service — Wave 8 (S7 gap closure)
 *
 * Models tenant-scoped stock of parts/assets that are NOT yet installed
 * against a unit (installed items live in asset_components). Every
 * material change flows through `warehouse_movements`, which is an
 * APPEND-ONLY ledger:
 *
 *   createItem   → row in warehouse_items + a 'receive' movement
 *   recordMovement → row in warehouse_movements + atomic quantity /
 *                    condition patch on the parent item
 *
 * Invariants:
 *   - Quantity can never go negative (negative deltas clamped at zero
 *     are rejected, not silently absorbed).
 *   - Tenant isolation: every read/write filters by tenantId; a mismatch
 *     on getItem surfaces TENANT_MISMATCH rather than leaking existence.
 *   - Deterministic IDs via `randomHex(16)` — 32 hex chars, CSPRNG-backed.
 *
 * Pure-ish / functional: returned objects are new; internal state lives
 * only in the repository. All failures use the Result shape
 * `{ ok: false, error: { code, message } }` so routers map cleanly.
 */
import { randomHex } from '../common/id-generator.js';

// ----------------------------------------------------------------------------
// Types — kept local to the service to avoid leaking Drizzle types into
// consumers. The repository handles row <-> entity mapping.
// ----------------------------------------------------------------------------

export type WarehouseItemCondition =
  | 'new'
  | 'functioning'
  | 'broken'
  | 'in_transit'
  | 'decommissioned'
  | 'reserved';

export type WarehouseMovementType =
  | 'receive'
  | 'issue'
  | 'transfer'
  | 'adjust'
  | 'install'
  | 'uninstall'
  | 'decommission'
  | 'return'
  | 'damage'
  | 'repair';

export interface WarehouseItem {
  readonly id: string;
  readonly tenantId: string;
  readonly sku: string;
  readonly name: string;
  readonly category: string;
  readonly description: string | null;
  readonly unitOfMeasure: string;
  readonly quantity: number;
  readonly condition: WarehouseItemCondition;
  readonly warehouseLocation: string | null;
  readonly costMinorUnits: number | null;
  readonly currency: string | null;
  readonly supplierName: string | null;
  readonly purchaseOrderRef: string | null;
  readonly notes: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdBy: string | null;
  readonly updatedBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export interface WarehouseMovement {
  readonly id: string;
  readonly tenantId: string;
  readonly warehouseItemId: string;
  readonly movementType: WarehouseMovementType;
  readonly quantityDelta: number;
  readonly conditionFrom: WarehouseItemCondition | null;
  readonly conditionTo: WarehouseItemCondition | null;
  readonly destination: string | null;
  readonly relatedCaseId: string | null;
  readonly relatedUnitId: string | null;
  readonly reason: string | null;
  readonly performedBy: string;
  readonly occurredAt: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

// ----------------------------------------------------------------------------
// Inputs
// ----------------------------------------------------------------------------

export interface CreateWarehouseItemInput {
  readonly sku: string;
  readonly name: string;
  readonly category: string;
  readonly description?: string | null;
  readonly unitOfMeasure?: string;
  readonly quantity?: number;
  readonly condition?: WarehouseItemCondition;
  readonly warehouseLocation?: string | null;
  readonly costMinorUnits?: number | null;
  readonly currency?: string | null;
  readonly supplierName?: string | null;
  readonly purchaseOrderRef?: string | null;
  readonly notes?: string | null;
  readonly metadata?: Record<string, unknown>;
}

export interface RecordMovementInput {
  readonly warehouseItemId: string;
  readonly movementType: WarehouseMovementType;
  readonly quantityDelta: number;
  readonly conditionFrom?: WarehouseItemCondition | null;
  readonly conditionTo?: WarehouseItemCondition | null;
  readonly destination?: string | null;
  readonly relatedCaseId?: string | null;
  readonly relatedUnitId?: string | null;
  readonly reason?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly occurredAt?: Date;
}

export interface ListItemsFilters {
  readonly category?: string;
  readonly condition?: WarehouseItemCondition;
}

// ----------------------------------------------------------------------------
// Repository port — implemented by
// packages/database/src/repositories/warehouse-repository.ts, but any
// in-memory implementation (see tests) satisfies the same surface.
// ----------------------------------------------------------------------------

export interface WarehouseRepositoryPort {
  insertItem(item: WarehouseItem): Promise<WarehouseItem>;
  updateItemQuantityAndCondition(
    tenantId: string,
    itemId: string,
    patch: {
      quantity: number;
      condition: WarehouseItemCondition;
      updatedBy: string;
      updatedAt: Date;
    }
  ): Promise<WarehouseItem | null>;
  insertMovement(movement: WarehouseMovement): Promise<WarehouseMovement>;
  /**
   * Execute fn atomically. Implementations back this with a DB tx; the
   * in-memory test fake simply invokes fn against itself.
   */
  withTransaction<T>(fn: (tx: WarehouseRepositoryPort) => Promise<T>): Promise<T>;
  findItemById(tenantId: string, itemId: string): Promise<WarehouseItem | null>;
  /**
   * Variant that does NOT filter by tenant — used only so the service can
   * surface TENANT_MISMATCH (instead of NOT_FOUND) when a caller references
   * an item from another tenant. Keep out of routers.
   */
  findItemByIdAnyTenant(itemId: string): Promise<WarehouseItem | null>;
  listItems(
    tenantId: string,
    filters: ListItemsFilters
  ): Promise<readonly WarehouseItem[]>;
  listMovements(
    tenantId: string,
    itemId: string
  ): Promise<readonly WarehouseMovement[]>;
}

// ----------------------------------------------------------------------------
// Errors + Result
// ----------------------------------------------------------------------------

export type WarehouseErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'TENANT_MISMATCH'
  | 'INSUFFICIENT_STOCK'
  | 'DUPLICATE_SKU'
  | 'INTERNAL_ERROR';

export interface WarehouseError {
  readonly code: WarehouseErrorCode;
  readonly message: string;
}

export type WarehouseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WarehouseError };

function ok<T>(value: T): WarehouseResult<T> {
  return { ok: true, value };
}

function err<T = never>(
  code: WarehouseErrorCode,
  message: string
): WarehouseResult<T> {
  return { ok: false, error: { code, message } };
}

// ----------------------------------------------------------------------------
// Service contract
// ----------------------------------------------------------------------------

export interface WarehouseService {
  createItem(
    tenantId: string,
    input: CreateWarehouseItemInput,
    userId: string
  ): Promise<WarehouseResult<WarehouseItem>>;

  recordMovement(
    tenantId: string,
    input: RecordMovementInput,
    userId: string
  ): Promise<WarehouseResult<{ item: WarehouseItem; movement: WarehouseMovement }>>;

  listItems(
    tenantId: string,
    filters?: ListItemsFilters
  ): Promise<readonly WarehouseItem[]>;

  getItem(
    tenantId: string,
    itemId: string
  ): Promise<WarehouseResult<WarehouseItem | null>>;

  listMovements(
    tenantId: string,
    itemId: string
  ): Promise<WarehouseResult<readonly WarehouseMovement[]>>;
}

export interface WarehouseServiceDeps {
  readonly repo: WarehouseRepositoryPort;
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
}

// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------

export function createWarehouseService(
  deps: WarehouseServiceDeps
): WarehouseService {
  const now = deps.now ?? (() => new Date());
  const genId = deps.idGenerator ?? (() => randomHex(16));

  function validateCreateInput(
    input: CreateWarehouseItemInput
  ): WarehouseError | null {
    if (!input.sku || input.sku.trim().length === 0) {
      return { code: 'VALIDATION', message: 'sku is required' };
    }
    if (!input.name || input.name.trim().length === 0) {
      return { code: 'VALIDATION', message: 'name is required' };
    }
    if (!input.category || input.category.trim().length === 0) {
      return { code: 'VALIDATION', message: 'category is required' };
    }
    if (input.quantity !== undefined && input.quantity < 0) {
      return { code: 'VALIDATION', message: 'quantity must be >= 0' };
    }
    return null;
  }

  return {
    async createItem(tenantId, input, userId) {
      if (!tenantId) {
        return err('VALIDATION', 'tenantId is required');
      }
      const badInput = validateCreateInput(input);
      if (badInput) return { ok: false, error: badInput };

      const nowDate = now();
      const nowIso = nowDate.toISOString();
      const itemId = genId();
      const quantity = input.quantity ?? 0;
      const condition: WarehouseItemCondition = input.condition ?? 'new';

      const item: WarehouseItem = {
        id: itemId,
        tenantId,
        sku: input.sku,
        name: input.name,
        category: input.category,
        description: input.description ?? null,
        unitOfMeasure: input.unitOfMeasure ?? 'each',
        quantity,
        condition,
        warehouseLocation: input.warehouseLocation ?? null,
        costMinorUnits: input.costMinorUnits ?? null,
        currency: input.currency ?? null,
        supplierName: input.supplierName ?? null,
        purchaseOrderRef: input.purchaseOrderRef ?? null,
        notes: input.notes ?? null,
        metadata: input.metadata ?? {},
        createdBy: userId,
        updatedBy: userId,
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
      };

      try {
        const saved = await deps.repo.withTransaction(async (tx) => {
          const persisted = await tx.insertItem(item);
          // Only record an initial `receive` movement when opening stock
          // is non-zero — zero-quantity item creation is a catalog op and
          // should not pollute the movements ledger.
          if (quantity > 0) {
            const movement: WarehouseMovement = {
              id: genId(),
              tenantId,
              warehouseItemId: itemId,
              movementType: 'receive',
              quantityDelta: quantity,
              conditionFrom: null,
              conditionTo: condition,
              destination: null,
              relatedCaseId: null,
              relatedUnitId: null,
              reason: 'initial stock',
              performedBy: userId,
              occurredAt: nowIso,
              metadata: {},
              createdAt: nowIso,
            };
            await tx.insertMovement(movement);
          }
          return persisted;
        });
        return ok(saved);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown';
        // UNIQUE(tenant_id, sku) violation — surface a domain-level code.
        if (/unique|duplicate/i.test(msg)) {
          return err('DUPLICATE_SKU', `sku '${input.sku}' already exists`);
        }
        return err('INTERNAL_ERROR', msg);
      }
    },

    async recordMovement(tenantId, input, userId) {
      if (!tenantId) {
        return err('VALIDATION', 'tenantId is required');
      }
      if (!input.warehouseItemId) {
        return err('VALIDATION', 'warehouseItemId is required');
      }
      if (!Number.isInteger(input.quantityDelta)) {
        return err('VALIDATION', 'quantityDelta must be an integer');
      }
      if (input.quantityDelta === 0 && !input.conditionTo) {
        return err(
          'VALIDATION',
          'movement must change either quantity or condition'
        );
      }

      try {
        return await deps.repo.withTransaction(async (tx) => {
          const item = await tx.findItemById(tenantId, input.warehouseItemId);
          if (!item) {
            // Disambiguate NOT_FOUND vs TENANT_MISMATCH so auditors can
            // tell the two apart.
            const foreign = await tx.findItemByIdAnyTenant(
              input.warehouseItemId
            );
            if (foreign) {
              return err(
                'TENANT_MISMATCH',
                `item ${input.warehouseItemId} belongs to another tenant`
              );
            }
            return err('NOT_FOUND', `item ${input.warehouseItemId} not found`);
          }

          const nextQuantity = item.quantity + input.quantityDelta;
          if (nextQuantity < 0) {
            return err(
              'INSUFFICIENT_STOCK',
              `quantity would become ${nextQuantity} (current=${item.quantity}, delta=${input.quantityDelta})`
            );
          }

          const nowDate = input.occurredAt ?? now();
          const nowIso = nowDate.toISOString();
          const nextCondition: WarehouseItemCondition =
            input.conditionTo ?? item.condition;

          const updatedItem = await tx.updateItemQuantityAndCondition(
            tenantId,
            item.id,
            {
              quantity: nextQuantity,
              condition: nextCondition,
              updatedBy: userId,
              updatedAt: nowDate,
            }
          );
          if (!updatedItem) {
            return err(
              'INTERNAL_ERROR',
              'failed to update warehouse item after quantity check'
            );
          }

          const movement: WarehouseMovement = {
            id: genId(),
            tenantId,
            warehouseItemId: item.id,
            movementType: input.movementType,
            quantityDelta: input.quantityDelta,
            conditionFrom: input.conditionFrom ?? item.condition,
            conditionTo: input.conditionTo ?? nextCondition,
            destination: input.destination ?? null,
            relatedCaseId: input.relatedCaseId ?? null,
            relatedUnitId: input.relatedUnitId ?? null,
            reason: input.reason ?? null,
            performedBy: userId,
            occurredAt: nowIso,
            metadata: input.metadata ?? {},
            createdAt: nowIso,
          };
          const persistedMovement = await tx.insertMovement(movement);

          return ok({ item: updatedItem, movement: persistedMovement });
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown';
        return err('INTERNAL_ERROR', msg);
      }
    },

    async listItems(tenantId, filters) {
      if (!tenantId) return [];
      return deps.repo.listItems(tenantId, filters ?? {});
    },

    async getItem(tenantId, itemId) {
      if (!tenantId) {
        return err('VALIDATION', 'tenantId is required');
      }
      if (!itemId) {
        return err('VALIDATION', 'itemId is required');
      }
      const scoped = await deps.repo.findItemById(tenantId, itemId);
      if (scoped) return ok(scoped);

      // Cross-tenant probe so we can surface TENANT_MISMATCH distinctly.
      const foreign = await deps.repo.findItemByIdAnyTenant(itemId);
      if (foreign) {
        return err(
          'TENANT_MISMATCH',
          `item ${itemId} belongs to another tenant`
        );
      }
      return ok(null);
    },

    async listMovements(tenantId, itemId) {
      if (!tenantId) {
        return err('VALIDATION', 'tenantId is required');
      }
      if (!itemId) {
        return err('VALIDATION', 'itemId is required');
      }
      const scoped = await deps.repo.findItemById(tenantId, itemId);
      if (!scoped) {
        const foreign = await deps.repo.findItemByIdAnyTenant(itemId);
        if (foreign) {
          return err(
            'TENANT_MISMATCH',
            `item ${itemId} belongs to another tenant`
          );
        }
        return err('NOT_FOUND', `item ${itemId} not found`);
      }
      const movements = await deps.repo.listMovements(tenantId, itemId);
      return ok(movements);
    },
  };
}
