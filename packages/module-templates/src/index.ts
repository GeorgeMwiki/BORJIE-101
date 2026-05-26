/**
 * @borjie/module-templates — Ten platform-built-in module templates
 * registered as a single immutable bundle list. The orchestrator's
 * boot routine reads `ALL_TEMPLATE_BUNDLES` and UPSERTs each into the
 * `module_templates` + `module_accept_handlers` tables.
 *
 * Two handler sets ship live today:
 *   - ESTATE → `create_lease_application`, `post_receipt_draft`
 *   - MINING → `schedule_licence_renewal`, `open_equipment_maintenance`,
 *              `bulk_mark_licences_for_renewal`
 *
 * The 3 MINING handlers replace the BossNyumba-era estate stubs
 * (TODO(#34) closed). The other nine module templates register handler
 * stubs; their wiring lands in later waves.
 */

export type {
  ModuleTemplateBundle,
  AcceptHandlerDescriptor,
} from './types.js';

import type { ModuleTemplateBundle } from './types.js';
import { estateBundle } from './templates/estate/index.js';
import { hrBundle } from './templates/hr/index.js';
import { fleetBundle } from './templates/fleet/index.js';
import { procurementBundle } from './templates/procurement/index.js';
import { legalBundle } from './templates/legal/index.js';
import { financeBundle } from './templates/finance/index.js';
import { strategyBundle } from './templates/strategy/index.js';
import { complianceBundle } from './templates/compliance/index.js';
import { crmBundle } from './templates/crm/index.js';
import { inventoryBundle } from './templates/inventory/index.js';

export {
  estateBundle,
  hrBundle,
  fleetBundle,
  procurementBundle,
  legalBundle,
  financeBundle,
  strategyBundle,
  complianceBundle,
  crmBundle,
  inventoryBundle,
};

export const ALL_TEMPLATE_BUNDLES: ReadonlyArray<ModuleTemplateBundle> =
  Object.freeze([
    estateBundle,
    hrBundle,
    fleetBundle,
    procurementBundle,
    legalBundle,
    financeBundle,
    strategyBundle,
    complianceBundle,
    crmBundle,
    inventoryBundle,
  ]);

/**
 * Look up a bundle by slug. Returns undefined when the slug is unknown.
 */
export function findBundle(
  slug: string,
): ModuleTemplateBundle | undefined {
  return ALL_TEMPLATE_BUNDLES.find((b) => b.slug === slug);
}

// Re-export ESTATE handler symbols so the executor can import the live
// implementation directly during Wave 22 development.
export {
  createLeaseApplicationHandler,
  CreateLeaseApplicationPayloadSchema,
  type CreateLeaseApplicationPayload,
  type CreateLeaseApplicationDeps,
  type CreateLeaseApplicationContext,
  type CreateLeaseApplicationResult,
} from './templates/estate/index.js';

// ─── ESTATE — 2 surviving actions + cross-module registry ─────────────────

export {
  buildEstateHandlerSet,
  ESTATE_ACTIONS,
  createCreateLeaseApplicationAdapter,
  createPostReceiptDraftAdapter,
  postReceiptDraftHandler,
  PostReceiptDraftPayloadSchema,
  type EstateHandlerDeps,
  type BuildEstateHandlerSet,
} from './estate/accept-proposal-handlers.js';

export type {
  PostReceiptDraftDeps,
  PostReceiptDraftPayload,
  PostReceiptDraftContext,
  PostReceiptDraftResult,
  LedgerDraftPort,
  ReceiptStorePort,
} from './templates/estate/handlers/post-receipt-draft.js';

// ─── MINING — 3 actions (replaces the BossNyumba estate stubs) ────────────

export {
  buildMiningHandlerSet,
  MINING_ACTIONS,
  createScheduleLicenceRenewalAdapter,
  createOpenEquipmentMaintenanceAdapter,
  createBulkMarkLicencesForRenewalAdapter,
  scheduleLicenceRenewalHandler,
  ScheduleLicenceRenewalPayloadSchema,
  openEquipmentMaintenanceHandler,
  OpenEquipmentMaintenancePayloadSchema,
  bulkMarkLicencesForRenewalHandler,
  BulkMarkLicencesForRenewalPayloadSchema,
  type MiningHandlerDeps,
  type BuildMiningHandlerSet,
} from './mining/accept-proposal-handlers.js';

export type {
  ScheduleLicenceRenewalDeps,
  ScheduleLicenceRenewalPayload,
  ScheduleLicenceRenewalContext,
  ScheduleLicenceRenewalResult,
  TemporalEntityStorePort,
} from './templates/mining/handlers/schedule-licence-renewal.js';

export type {
  OpenEquipmentMaintenanceDeps,
  OpenEquipmentMaintenancePayload,
  OpenEquipmentMaintenanceContext,
  OpenEquipmentMaintenanceResult,
  MaintenanceEventStorePort,
} from './templates/mining/handlers/open-equipment-maintenance.js';

export type {
  BulkMarkLicencesForRenewalDeps,
  BulkMarkLicencesForRenewalPayload,
  BulkMarkLicencesForRenewalContext,
  BulkMarkLicencesForRenewalResult,
  BulkLicenceTaskStorePort,
} from './templates/mining/handlers/bulk-mark-licences-for-renewal.js';

export {
  createModuleHandlerRegistry,
  withInvocationTracking,
  type ModuleHandlerRegistry,
  type CreateModuleHandlerRegistryDeps,
  type RegisteredHandlerInfo,
} from './registry.js';
