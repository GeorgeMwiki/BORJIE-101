/**
 * Vendor API framework — WAVE 28.
 *
 * Pluggable adapter system for physical-world vendor dispatch:
 *   - adapter-contract.ts: the port interface every adapter implements
 *   - adapters/: 4 built-in implementations (ServiceChannel, UpKeep,
 *     generic webhook, manual-queue fallback)
 *   - adapter-registry.ts: routes vendor records to the right adapter
 *   - orchestration.ts: VendorDispatchOrchestrator — ticket lifecycle
 *
 * Consumed by the api-gateway vendor-dispatch router and by Agent
 * ORCHESTRATE's maintenance-dispatch flow.
 */

export type {
  AvailabilityWindow,
  DateRange,
  DispatchInput,
  DispatchResult,
  DispatchStatus,
  FetchLike,
  HealthStatus,
  InvoiceResult,
  OnSiteConfirmation,
  VendorAdapterId,
  VendorApiAdapter,
  VendorCapability,
  VendorInvoice,
} from './adapter-contract.js';
export { VendorAdapterError } from './adapter-contract.js';

export {
  ServiceChannelAdapter,
  type ServiceChannelAdapterConfig,
} from './adapters/service-channel-adapter.js';
export {
  UpKeepAdapter,
  type UpKeepAdapterConfig,
} from './adapters/upkeep-adapter.js';
export {
  GenericWebhookAdapter,
  type GenericWebhookAdapterConfig,
} from './adapters/generic-webhook-adapter.js';
export {
  ManualQueueAdapter,
  createInMemoryManualQueueStore,
  type ManualQueueAdapterConfig,
  type ManualQueueEntry,
  type ManualQueueStore,
} from './adapters/manual-queue-adapter.js';

export {
  createVendorAdapterRegistry,
  type VendorAdapterRegistry,
  type VendorRecordLike,
} from './adapter-registry.js';

export {
  VendorDispatchOrchestrator,
  createInMemoryDispatchStore,
  type DispatchBusEvent,
  type DispatchEventBus,
  type DispatchOutcome,
  type DispatchRecord,
  type DispatchStore,
  type MaintenanceTicketLike,
  type VendorCandidate,
  type VendorDispatchOrchestratorDeps,
  type VendorSelector,
} from './orchestration.js';
