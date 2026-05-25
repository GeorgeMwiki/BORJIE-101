/**
 * Warehouse module — Wave 8 (S7 gap closure).
 * Re-exports the service + Drizzle repo for the composition root.
 */
export {
  createWarehouseService,
  type WarehouseService,
  type WarehouseServiceDeps,
  type WarehouseItem,
  type WarehouseMovement,
  type WarehouseItemCondition,
  type WarehouseMovementType,
  type WarehouseRepositoryPort,
  type WarehouseError,
  type WarehouseErrorCode,
  type WarehouseResult,
  type CreateWarehouseItemInput,
  type RecordMovementInput,
  type ListItemsFilters,
} from './warehouse-service.js';

export { DrizzleWarehouseRepository } from './drizzle-warehouse-repository.js';
