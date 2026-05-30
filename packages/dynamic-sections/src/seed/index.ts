/**
 * Public surface for the seed registry. Portals import this module
 * to bootstrap a `SectionRegistry` pre-populated with the eight
 * Borjie mining-domain sections.
 */

export { seedSections, seedSectionKeys } from './seed-sections.js';
export {
  PmlLicencesSection,
  RoyaltyDraftsSection,
  ActiveShiftsSection,
  OreParcelsSection,
  NemcFilingsSection,
  GeologyLogsSection,
  ComplianceDeadlinesSection,
  CooperativeMembershipSection,
} from './section-components.js';

import { SectionRegistry } from '../registry/section-registry.js';
import { seedSections } from './seed-sections.js';

/**
 * Convenience factory: build a fresh registry pre-loaded with the
 * eight Borjie mining-domain seed sections. Portals can chain
 * `.register()` to add their own entity-type-specific sections on top.
 */
export function createSeedRegistry(): SectionRegistry {
  return new SectionRegistry().registerAll(seedSections);
}
