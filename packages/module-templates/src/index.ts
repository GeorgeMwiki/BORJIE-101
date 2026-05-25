/**
 * @borjie/module-templates — Ten platform-built-in module templates
 * registered as a single immutable bundle list. The orchestrator's
 * boot routine reads `ALL_TEMPLATE_BUNDLES` and UPSERTs each into the
 * `module_templates` + `module_accept_handlers` tables.
 *
 * One template (ESTATE) ships a fully-wired `create_lease_application`
 * handler. The other nine register handler stubs; their wiring lands
 * in later waves (24+).
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

// ─── Wave-3-int2 — ESTATE 5-handler set + cross-module registry ──────────

export {
  buildEstateHandlerSet,
  ESTATE_ACTIONS,
  createCreateLeaseApplicationAdapter,
  createPostReceiptDraftAdapter,
  createOpenMaintenanceCaseAdapter,
  createScheduleRenewalNegotiationAdapter,
  createBulkMarkForRenewalPrepAdapter,
  postReceiptDraftHandler,
  PostReceiptDraftPayloadSchema,
  openMaintenanceCaseHandler,
  OpenMaintenanceCasePayloadSchema,
  scheduleRenewalNegotiationHandler,
  ScheduleRenewalNegotiationPayloadSchema,
  bulkMarkForRenewalPrepHandler,
  BulkMarkForRenewalPrepPayloadSchema,
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

export type {
  OpenMaintenanceCaseDeps,
  OpenMaintenanceCasePayload,
  OpenMaintenanceCaseContext,
  OpenMaintenanceCaseResult,
  MaintenanceTicketStorePort,
} from './templates/estate/handlers/open-maintenance-case.js';

export type {
  ScheduleRenewalNegotiationDeps,
  ScheduleRenewalNegotiationPayload,
  ScheduleRenewalNegotiationContext,
  ScheduleRenewalNegotiationResult,
  WorkAssignmentPort,
} from './templates/estate/handlers/schedule-renewal-negotiation.js';

export type {
  BulkMarkForRenewalPrepDeps,
  BulkMarkForRenewalPrepPayload,
  BulkMarkForRenewalPrepContext,
  BulkMarkForRenewalPrepResult,
  LeaseStorePort,
} from './templates/estate/handlers/bulk-mark-for-renewal-prep.js';

export {
  createModuleHandlerRegistry,
  withInvocationTracking,
  type ModuleHandlerRegistry,
  type CreateModuleHandlerRegistryDeps,
  type RegisteredHandlerInfo,
} from './registry.js';
