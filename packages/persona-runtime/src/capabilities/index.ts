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
  reasoningHint,
  exampleReasoningTrace,
} from './types.js';

export type {
  BilingualString,
  CapabilityEntry,
  CapabilityTopic,
  CapabilityVisibility,
} from './types.js';

// JA-3 — Jurisdiction-aware capability resolution.
export {
  CAPABILITY_JURISDICTION_OVERRIDES,
  getCapabilityOverride,
  hasJurisdictionOverrides,
  listCapabilitiesWithOverrides,
  type CapabilityJurisdictionOverride,
} from './jurisdiction-overrides.js';

/**
 * JA-3 — Resolver helper: given a base capability entry + country,
 * returns the entry with jurisdiction-correct user_outcome /
 * public_description / example_response_pattern fields.
 *
 * Default (no override registered, or country = 'TZ') returns the
 * base entry untouched.
 */
import type { CapabilityEntry as _CE } from './types.js';
import { getCapabilityOverride as _resolveOverride } from './jurisdiction-overrides.js';

export function resolveCapabilityForJurisdiction(
  entry: _CE,
  country: string,
): _CE {
  const override = _resolveOverride(entry.id, country);
  if (!override) return entry;
  return Object.freeze({
    ...entry,
    ...(override.user_outcome !== undefined && {
      user_outcome: override.user_outcome,
    }),
    ...(override.public_description !== undefined && {
      public_description: override.public_description,
    }),
    ...(override.example_response_pattern !== undefined && {
      example_response_pattern: override.example_response_pattern,
    }),
  });
}
