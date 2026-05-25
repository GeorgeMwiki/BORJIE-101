/**
 * Voice-Persona DNA — public surface.
 *
 * Pinned persona profiles, a heuristic consistency validator, and a
 * drift detector that watches rolling persona-fit scores per tenant.
 */

export * from './types.js';
export {
  HEAD_PROFILE,
  OWNER_PROFILE,
  TENANT_PROFILE,
  VENDOR_PROFILE,
  REGULATOR_PROFILE,
  APPLICANT_PROFILE,
  ALL_PROFILES,
  getProfile,
  listProfiles,
} from './profiles.js';
export { scorePersonaFit } from './consistency-validator.js';
export {
  createPersonaDriftDetector,
  type PersonaDriftDetector,
  type PersonaDriftDetectorOptions,
} from './drift-detector.js';
