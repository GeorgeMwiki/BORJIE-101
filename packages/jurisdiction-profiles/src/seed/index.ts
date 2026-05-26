/**
 * Seed barrel for `@borjie/jurisdiction-profiles/seed`.
 *
 * Re-exports the compliance-framework + control-mapping seed array so
 * a composition root can install them in one call:
 *
 *   import {
 *     ALL_FRAMEWORKS,
 *     ALL_CONTROL_MAPPINGS,
 *   } from '@borjie/jurisdiction-profiles/seed';
 *
 *   const reg = registerControlMappings(
 *     registerFrameworks(emptyFrameworkRegistry(), ALL_FRAMEWORKS),
 *     ALL_CONTROL_MAPPINGS,
 *   );
 */

export {
  ALL_FRAMEWORKS,
  ALL_CONTROL_MAPPINGS,
  gdpr,
  ukGdpr,
  tzDpa2022,
  keDpa2019,
  ndpa2023,
  popia,
  ccpa,
  cpra,
  lgpd,
  pdpaSg,
  dpdpIn,
  pipl,
  kvkk,
  lfpdppp,
  pipeda,
  appi,
  hipaa,
  ferpa,
  coppa,
} from './seed-frameworks.js';
