/**
 * `@borjie/brain-llm-router/routing-overrides` — public surface.
 *
 * Admin-configurable per-tenant per-task routing overrides. Allows ops
 * to flip e.g. `lease_drafting: opus → sonnet` during an Anthropic
 * outage WITHOUT redeploying.
 *
 * Ports + adapters (DB adapter is a follow-up):
 *
 *     getOverrideFor(tenantId, taskCategory) → { family, reason } | null
 *
 * The in-memory adapter is enough for tests + standalone bootstrap;
 * a Drizzle adapter slots in at composition root.
 */

export {
  routingOverrideEntrySchema,
  routingOverridePatchSchema,
  LOCKED_CATEGORIES,
  type RoutingOverrideEntry,
  type RoutingOverridePatch,
} from './schema.js';
export {
  type OverridePort,
  type RoutingOverride,
} from './override-port.js';
export {
  InMemoryOverrideAdapter,
} from './in-memory-adapter.js';
export {
  RoutingOverrideRepository,
} from './repository.js';
