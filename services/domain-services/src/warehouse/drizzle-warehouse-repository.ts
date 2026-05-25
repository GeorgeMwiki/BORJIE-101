// @ts-nocheck — TODO(borjie-hard-fork): property-domain repository pending mining-equivalent rewrite.
/**
 * Drizzle implementation of WarehouseRepositoryPort.
 *
 * Backed by `warehouse_items` + `warehouse_movements` tables. The
 * movements ledger is append-only; items carry the current quantity +
 * condition as a projection maintained by the service.
 *
 * withTransaction wraps in a real Postgres tx so insertMovement +
 * updateItemQuantityAndCondition are atomic per recordMovement call.
 */

import { and, asc, desc, eq } from 'drizzle-orm';
import {
  warehouseItems,
  warehouseMovements,
} from '@borjie/database';
import type {
  WarehouseItem,
  WarehouseMovement,
  WarehouseRepositoryPort,
  ListItemsFilters,
} from './warehouse-service.js';

type DbClient = any;

function rowToItem(row: any): WarehouseItem {
  return {
    id: row.id,
    tenantId: row.tenantId ?? row.tenant_id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    description: row.description ?? null,
    unitOfMeasure: row.unitOfMeasure ?? row.unit_of_measure,
    quantity: Number(row.quantity),
    condition: row.condition,
    warehouseLocation: row.warehouseLocation ?? row.warehouse_location ?? null,
    costMinorUnits: row.costMinorUnits ?? row.cost_minor_units ?? null,
    currency: row.currency ?? null,
    supplierName: row.supplierName ?? row.supplier_name ?? null,
    purchaseOrderRef: row.purchaseOrderRef ?? row.purchase_order_ref ?? null,
    notes: row.notes ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdBy: row.createdBy ?? row.created_by ?? null,
    updatedBy: row.updatedBy ?? row.updated_by ?? null,
    createdAt: (row.createdAt ?? row.created_at)?.toISOString?.() ?? String(row.createdAt ?? row.created_at),
    updatedAt: (row.updatedAt ?? row.updated_at)?.toISOString?.() ?? String(row.updatedAt ?? row.updated_at),
    deletedAt:
      (row.deletedAt ?? row.deleted_at)?.toISOString?.() ??
      (row.deletedAt ?? row.deleted_at ?? null),
  };
}

function rowToMovement(row: any): WarehouseMovement {
  return {
    id: row.id,
    tenantId: row.tenantId ?? row.tenant_id,
    warehouseItemId: row.warehouseItemId ?? row.warehouse_item_id,
    movementType: row.movementType ?? row.movement_type,
    quantityDelta: Number(row.quantityDelta ?? row.quantity_delta),
    conditionFrom: row.conditionFrom ?? row.condition_from ?? null,
    conditionTo: row.conditionTo ?? row.condition_to ?? null,
    destination: row.destination ?? null,
    relatedCaseId: row.relatedCaseId ?? row.related_case_id ?? null,
    relatedUnitId: row.relatedUnitId ?? row.related_unit_id ?? null,
    reason: row.reason ?? null,
    performedBy: row.performedBy ?? row.performed_by,
    occurredAt: (row.occurredAt ?? row.occurred_at)?.toISOString?.() ?? String(row.occurredAt ?? row.occurred_at),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: (row.createdAt ?? row.created_at)?.toISOString?.() ?? String(row.createdAt ?? row.created_at),
  };
}

export class DrizzleWarehouseRepository implements WarehouseRepositoryPort {
  constructor(private readonly db: DbClient) {}

  async insertItem(item: WarehouseItem): Promise<WarehouseItem> {
    await this.db.insert(warehouseItems).values({
      id: item.id,
      tenantId: item.tenantId,
      sku: item.sku,
      name: item.name,
      category: item.category,
      description: item.description,
      unitOfMeasure: item.unitOfMeasure,
      quantity: item.quantity,
      condition: item.condition,
      warehouseLocation: item.warehouseLocation,
      costMinorUnits: item.costMinorUnits,
      currency: item.currency,
      supplierName: item.supplierName,
      purchaseOrderRef: item.purchaseOrderRef,
      notes: item.notes,
      metadata: item.metadata,
      createdBy: item.createdBy,
      updatedBy: item.updatedBy,
    });
    return item;
  }

  async updateItemQuantityAndCondition(
    tenantId: string,
    itemId: string,
    patch: { quantity: number; condition: string; updatedBy: string; updatedAt: Date }
  ): Promise<WarehouseItem | null> {
    await this.db
      .update(warehouseItems)
      .set({
        quantity: patch.quantity,
        condition: patch.condition,
        updatedBy: patch.updatedBy,
        updatedAt: patch.updatedAt,
      })
      .where(
        and(eq(warehouseItems.tenantId, tenantId), eq(warehouseItems.id, itemId))
      );
    return this.findItemById(tenantId, itemId);
  }

  async insertMovement(movement: WarehouseMovement): Promise<WarehouseMovement> {
    await this.db.insert(warehouseMovements).values({
      id: movement.id,
      tenantId: movement.tenantId,
      warehouseItemId: movement.warehouseItemId,
      movementType: movement.movementType,
      quantityDelta: movement.quantityDelta,
      conditionFrom: movement.conditionFrom,
      conditionTo: movement.conditionTo,
      destination: movement.destination,
      relatedCaseId: movement.relatedCaseId,
      relatedUnitId: movement.relatedUnitId,
      reason: movement.reason,
      performedBy: movement.performedBy,
      metadata: movement.metadata,
    });
    return movement;
  }

  async withTransaction<T>(
    fn: (tx: WarehouseRepositoryPort) => Promise<T>
  ): Promise<T> {
    if (typeof this.db.transaction === 'function') {
      return this.db.transaction(async (tx: DbClient) =>
        fn(new DrizzleWarehouseRepository(tx))
      );
    }
    // Fallback (single-statement db — still safe if caller is sequential).
    return fn(this);
  }

  async findItemById(tenantId: string, itemId: string): Promise<WarehouseItem | null> {
    const rows = await this.db
      .select()
      .from(warehouseItems)
      .where(
        and(eq(warehouseItems.tenantId, tenantId), eq(warehouseItems.id, itemId))
      )
      .limit(1);
    return rows[0] ? rowToItem(rows[0]) : null;
  }

  async findItemByIdAnyTenant(itemId: string): Promise<WarehouseItem | null> {
    const rows = await this.db
      .select()
      .from(warehouseItems)
      .where(eq(warehouseItems.id, itemId))
      .limit(1);
    return rows[0] ? rowToItem(rows[0]) : null;
  }

  async listItems(
    tenantId: string,
    filters: ListItemsFilters
  ): Promise<readonly WarehouseItem[]> {
    const conds = [eq(warehouseItems.tenantId, tenantId)];
    if (filters.category) conds.push(eq(warehouseItems.category, filters.category));
    if (filters.condition) conds.push(eq(warehouseItems.condition, filters.condition));
    const rows = await this.db
      .select()
      .from(warehouseItems)
      .where(and(...conds))
      .orderBy(asc(warehouseItems.name));
    return rows.map(rowToItem);
  }

  async listMovements(
    tenantId: string,
    itemId: string
  ): Promise<readonly WarehouseMovement[]> {
    const rows = await this.db
      .select()
      .from(warehouseMovements)
      .where(
        and(
          eq(warehouseMovements.tenantId, tenantId),
          eq(warehouseMovements.warehouseItemId, itemId)
        )
      )
      .orderBy(desc(warehouseMovements.occurredAt));
    return rows.map(rowToMovement);
  }
}