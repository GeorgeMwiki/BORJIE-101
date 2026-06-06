/**
 * Warehouse module — Wave 8 (S7 gap closure).
 *
 * Mining-domain Wave 5 — the property-inventory
 * `DrizzleWarehouseRepository` has been removed. The live capability is
 * the mining ore-stockpile + grading service below
 * (`createMiningWarehouseService`), which consumes the ore repos from
 * `@borjie/domain-services/ore`. The legacy property `WarehouseService`
 * factory + types stay exported for back-compat with consumers that
 * still null-check the old slot shape.
 */

// Mining-domain warehouse: ore stockpiles + ore grading (the live one).
export {
  createMiningWarehouseService,
  type MiningWarehouseService,
  type MiningWarehouseServiceDeps,
  type MiningWarehouseResult,
  type MiningWarehouseError,
  type MiningWarehouseErrorCode,
  type StockpileView,
  type CustodyEventView,
  type CreateStockpileRequest,
  type TransferRequest,
  type GradeRequest,
  type ListStockpilesFilters,
} from './mining-warehouse-service.js';

// Legacy property warehouse (retired repo; kept for slot-shape compat).
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
