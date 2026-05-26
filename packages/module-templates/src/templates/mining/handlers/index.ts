/**
 * Mining-domain accept-proposal handlers — barrel.
 *
 * Three handlers converted from the BossNyumba-era estate stubs (the
 * historical gh-issue #34 work-item, now closed) into typed mining-
 * domain inserts:
 *
 *   - schedule_licence_renewal       → tasks + temporal_entities
 *   - open_equipment_maintenance     → maintenance_events + tasks
 *   - bulk_mark_licences_for_renewal → tasks (bulk)
 *
 * Each handler:
 *   - validates inputs with Zod
 *   - writes typed Drizzle inserts via injected port shapes
 *   - returns `{ success: true, entity_id, evidence_ids, audit_chain_id }`
 */

export {
  scheduleLicenceRenewalHandler,
  ScheduleLicenceRenewalPayloadSchema,
  type ScheduleLicenceRenewalPayload,
  type ScheduleLicenceRenewalResult,
  type ScheduleLicenceRenewalDeps,
  type ScheduleLicenceRenewalContext,
  type TasksStorePort as ScheduleLicenceRenewalTasksStorePort,
  type TemporalEntityStorePort,
  type IdGeneratorPort as ScheduleLicenceRenewalIdGeneratorPort,
} from './schedule-licence-renewal.js';

export {
  openEquipmentMaintenanceHandler,
  OpenEquipmentMaintenancePayloadSchema,
  type OpenEquipmentMaintenancePayload,
  type OpenEquipmentMaintenanceResult,
  type OpenEquipmentMaintenanceDeps,
  type OpenEquipmentMaintenanceContext,
  type MaintenanceEventStorePort,
  type TasksStorePort as OpenEquipmentMaintenanceTasksStorePort,
  type IdGeneratorPort as OpenEquipmentMaintenanceIdGeneratorPort,
} from './open-equipment-maintenance.js';

export {
  bulkMarkLicencesForRenewalHandler,
  BulkMarkLicencesForRenewalPayloadSchema,
  type BulkMarkLicencesForRenewalPayload,
  type BulkMarkLicencesForRenewalResult,
  type BulkMarkLicencesForRenewalDeps,
  type BulkMarkLicencesForRenewalContext,
  type BulkLicenceTaskStorePort,
} from './bulk-mark-licences-for-renewal.js';
