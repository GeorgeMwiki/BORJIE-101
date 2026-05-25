/**
 * Vulnerable populations — public surface.
 */
export { createVulnerablePopulationsService, getVulnerabilitySafeguards } from './service.js';
export type {
  VulnerablePopulationsService,
  VulnerablePopulationsServiceDeps,
} from './service.js';
export { safeguardsFor, VULNERABILITY_RULES_FOR_TEST } from './safeguard-rules.js';
