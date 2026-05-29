/**
 * Capabilities barrel — single import point.
 *
 * Consumed by:
 *   - services/api-gateway/src/composition/brain-tools/capability-tools.ts
 *     (the `mwikila.capabilities.what_can_you_do` + `mwikila.about` tools)
 *   - services/api-gateway/src/routes/public-chat.hono.ts (disclosure rule
 *     injection)
 *   - services/api-gateway/src/routes/brain-teach.hono.ts (ditto)
 */

export {
  CAPABILITY_REGISTRY,
  CAPABILITY_COUNT,
  getCapabilityById,
  listCapabilitiesByTopic,
  listCapabilitiesByVisibility,
  listDisclosableCapabilities,
} from './capability-registry.js';

export {
  CAPABILITY_VISIBILITY,
  CAPABILITY_TOPIC,
  CapabilityEntrySchema,
  isDisclosable,
  parseCapabilityEntry,
} from './types.js';

export type {
  BilingualString,
  CapabilityEntry,
  CapabilityTopic,
  CapabilityVisibility,
} from './types.js';
