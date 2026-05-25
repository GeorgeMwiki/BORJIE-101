/**
 * Consent — public surface.
 */
export { createConsentService } from './consent-service.js';
export type { ConsentService, ConsentServiceDeps } from './consent-service.js';
export { ageOfDataConsent, needsParentalConsent } from './age-of-consent.js';
