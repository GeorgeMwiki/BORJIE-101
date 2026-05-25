/**
 * core-entity schema barrel — universal asset & entity model (Piece A).
 *
 * Exports the polymorphic root (`core_entity`), the type catalog
 * (`entity_type_definition`), the custom-field registry
 * (`tenant_schema_extensions`), and the per-type extension tables
 * (`entity_ext_land` / `entity_ext_building` / `entity_ext_vehicle` /
 * `entity_ext_machinery` / `entity_ext_it_asset` / `entity_ext_person`).
 *
 * All tables tenant-scoped via RLS (gold-standard pattern; see
 * migrations 0186-0194).
 */

export {
  coreEntity,
  CORE_ENTITY_EMBEDDING_DIM,
  CORE_ENTITY_LIFECYCLE_STATES,
  type CoreEntityRow,
  type CoreEntityInsert,
  type CoreEntityLifecycleState,
} from './core-entity.schema.js';

export {
  entityTypeDefinition,
  PLATFORM_BUILT_IN_ENTITY_TYPES,
  type EntityTypeDefinitionRow,
  type EntityTypeDefinitionInsert,
  type PlatformBuiltInEntityType,
} from './entity-type.schema.js';

export {
  tenantSchemaExtensions,
  TENANT_SCHEMA_FIELD_KINDS,
  TENANT_SCHEMA_INDEX_STRATEGIES,
  type TenantSchemaExtensionRow,
  type TenantSchemaExtensionInsert,
  type TenantSchemaFieldKind,
  type TenantSchemaIndexStrategy,
} from './tenant-schema-extensions.schema.js';

export {
  entityExtLand,
  type EntityExtLandRow,
  type EntityExtLandInsert,
} from './entity-ext-land.schema.js';

export {
  entityExtBuilding,
  type EntityExtBuildingRow,
  type EntityExtBuildingInsert,
} from './entity-ext-building.schema.js';

export {
  entityExtVehicle,
  type EntityExtVehicleRow,
  type EntityExtVehicleInsert,
} from './entity-ext-vehicle.schema.js';

export {
  entityExtMachinery,
  type EntityExtMachineryRow,
  type EntityExtMachineryInsert,
} from './entity-ext-machinery.schema.js';

export {
  entityExtItAsset,
  type EntityExtItAssetRow,
  type EntityExtItAssetInsert,
} from './entity-ext-it-asset.schema.js';

export {
  entityExtPerson,
  type EntityExtPersonRow,
  type EntityExtPersonInsert,
} from './entity-ext-person.schema.js';
