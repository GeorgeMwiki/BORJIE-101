/**
 * `@borjie/privacy-router` — public surface.
 *
 * Privacy-aware AI routing (LP-15 / PO-17). Routes inference requests by
 * data-sensitivity tier to satisfy Tanzania BOT Act / PDPA data-residency
 * rules:
 *
 *   RESTRICTED   -> local model only, deny if unavailable
 *   CONFIDENTIAL -> approved cloud + mandatory PII strip
 *   INTERNAL     -> approved cloud, no strip
 *   PUBLIC       -> approved cloud, no restrictions
 *
 * Wire-agnostic pure leaf: PII stripping, local-endpoint health, and
 * field classification are injected ports. The composition root supplies
 * the real `data-protection` adapters; tests supply deterministic stubs.
 * Ported from LITFIN `src/core/security/privacy-router.ts`.
 */

export {
  CLASSIFICATION_ORDER,
  type DataClassification,
  type TaskCategory,
  type ApprovedCloudProvider,
  type LocalProvider,
  type PrivacyProvider,
  type RoutingEndpoint,
  type StripResult,
  type PiiStripperPort,
  type LocalEndpointHealthPort,
  type FieldClassifierPort,
  type PrivacyRoutingRequest,
  type PrivacyRoutingResult,
  type PrivacyAuditEntry,
} from './types.js';

export {
  DEFAULT_PRIVACY_POLICY,
  privacyPolicySchema,
  parsePrivacyPolicyYaml,
  type PrivacyPolicy,
} from './policy.js';

export {
  createPrivacyRouter,
  type PrivacyRouter,
  type PrivacyRouterDeps,
  type PrivacyAuditStats,
} from './router.js';
