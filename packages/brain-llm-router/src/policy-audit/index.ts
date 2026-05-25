/**
 * `@borjie/brain-llm-router/policy-audit` — public surface.
 *
 * OCSF (Open Cybersecurity Schema Framework) audit emission for
 * min-tier policy enforcement events. When the min-tier policy upgrades
 * a model family, the SOC dashboard wants a structured event in the
 * audit chain — this module formats and emits it.
 *
 * Also exports the cross-family fallback alert helper — wires the
 * `onCrossFamilyFallback` hook (already on `runFallback`) to OTel +
 * Pino at composition root.
 */

export {
  formatPolicyDecisionOcsf,
  bindMinTierToOcsf,
  type PolicyDecisionOcsf,
  type OcsfEmitter,
} from './policy-decision-ocsf.js';

export {
  bindCrossFamilyFallbackToLogger,
  type CrossFamilyFallbackEvent,
  type CrossFamilyFallbackEmitter,
} from './cross-family-alert.js';
