/**
 * `@borjie/jurisdiction-profile-tz` — public surface (Wave UNIV-1).
 *
 * Tanzania launch-beachhead profile + four TZ regulators (TRA,
 * Tumemadini, NEMC, BoT). Wired into the composition root at app
 * bootstrap:
 *
 *   import { tzProfile, tzRegulators } from '@borjie/jurisdiction-profile-tz';
 *   const profiles = registerProfile(emptyProfileRegistry(), tzProfile);
 *   const regulators = registerRegulators(emptyRegulatorRegistry(), tzRegulators);
 *
 * Spec: Docs/DESIGN/UNIVERSAL_JURISDICTION_SPEC.md §7
 */

export {
  tzProfile,
  tzRegulators,
  tzTra,
  tzTumemadini,
  tzNemc,
  tzBot,
} from './tz-profile.js';
