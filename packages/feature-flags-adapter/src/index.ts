/**
 * `@borjie/feature-flags-adapter` — public surface.
 *
 * LITFIN-parity item 1: GrowthBook + Unleash + DB + in-memory
 * adapters behind a single port. Live test uses staged rollout per
 * tenant — no more all-or-nothing flips.
 */

export type {
  FeatureFlagsConfig,
  FeatureFlagsPort,
  Flag,
  FlagContext,
} from "./types.js";
export { createFeatureFlags } from "./feature-flags.js";
export {
  createInMemoryAdapter,
  type InMemoryAdapterConfig,
  type InMemoryFlagDefinition,
} from "./in-memory-adapter.js";
export {
  createGrowthBookAdapter,
  type GrowthBookAdapterConfig,
} from "./growthbook-adapter.js";
export {
  createUnleashAdapter,
  type UnleashAdapterConfig,
} from "./unleash-adapter.js";
export {
  createDBFeatureFlagsAdapter,
  type DBAdapterConfig,
  type DBClient,
} from "./db-adapter.js";
export {
  isPilotEnabled,
  isPilotKillSwitchOpen,
  isPilotEnvOptIn,
  PILOT_KILL_SWITCH_ENV,
  PILOT_ENABLED_ENV,
  PILOT_ENABLED_FLAG,
  PILOT_KILL_SWITCH_RESPONSE,
  type PilotEnabledQuery,
  type PilotEnvSource,
  type PilotKillSwitchDeps,
  type PilotKillSwitchResponse,
} from "./pilot-kill-switch.js";
