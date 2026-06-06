/**
 * Mining maintenance-taxonomy module — Borjie mining.
 *
 * Service layer for the `/api/v1/maintenance-taxonomy` route. Reshapes
 * the legacy property "category/problem" surface onto the mining
 * `equipment_maintenance_taxonomy` model (keyed on `assets.kind`) and is
 * backed by the real `DrizzleEquipmentMaintenanceTaxonomyRepository`.
 */

export * from './mining-taxonomy-types.js';
export * from './mining-maintenance-taxonomy-service.js';
