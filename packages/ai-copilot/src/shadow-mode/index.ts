/**
 * shadow-mode — barrel.
 *
 * Wave 28 dry-run mode that lets a tenant observe what Mr. Mwikila WOULD
 * have done for a period before turning on a given autonomy domain.
 */

export * from './types.js';
export {
  ShadowService,
  InMemoryShadowModeRepository,
  type ShadowServiceDeps,
} from './shadow-service.js';
