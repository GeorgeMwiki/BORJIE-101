/**
 * Public surface of the jurisdiction-resolver service — JA-1.
 *
 * Layered ABOVE tenant-config: composes the tenant row with a
 * frozen jurisdiction-authorities snapshot to produce a complete
 * `ResolvedJurisdiction` the brain-teach + public-chat prompts
 * (JA-2) and the two brain tools (JA-4/JA-5) can render directly.
 *
 * The resolver is the ONLY entrypoint the brain uses for the
 * jurisdiction context. Adding a country = one row in
 * `authorities.ts` + one row in `tenant-config/jurisdictions.ts`.
 */

export {
  createJurisdictionResolver,
  isSeededOverride,
} from './resolver.js';

export {
  getAuthoritiesByCountry,
  getFallbackAuthorities,
  JURISDICTION_AUTHORITIES,
} from './authorities.js';

export { detectJurisdiction } from './detector.js';

export {
  renderJurisdictionBlock,
  renderJurisdictionDisclosureRules,
  renderJurisdictionPromptSection,
} from './prompt.js';

export type {
  JurisdictionAuthorities,
  JurisdictionResolver,
  ResolvedJurisdiction,
} from './types.js';
