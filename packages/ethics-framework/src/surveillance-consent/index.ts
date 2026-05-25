/**
 * Surveillance consent — public surface.
 */
export { createSurveillanceConsentService } from './service.js';
export type {
  SurveillanceConsentService,
  SurveillanceConsentServiceDeps,
} from './service.js';
export { SURVEILLANCE_DISCLOSURE_RULES, disclosureRuleFor } from './disclosure-rules.js';
export type { DisclosureRule } from './disclosure-rules.js';
