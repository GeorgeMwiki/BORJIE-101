/**
 * Warehouse module — Wave 8 (S7 gap closure).
 *
 * Mining-domain Wave 5 — the property-inventory
 * `DrizzleWarehouseRepository` has been removed. The mining-domain
 * ore-stockpile repo (`DrizzleOreWarehouseRepository`) lives under
 * `@borjie/domain-services/ore`. The service class + types remain
 * exported for slot-shape compatibility while the wider migration
 * continues.
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
