/**
 * Policy module barrel.
 *
 * YAML-driven policy engine + intent verifier ported from LITFIN
 * (`src/core/security/policy-engine.ts` + `intent-verifier.ts`).
 * Worker-thread isolation deferred to a follow-up wave — this round
 * ships only the pure-function evaluation surface.
 *
 * See `.audit/litfin-sota-2026-05-23/03-security-governance.md` (SC-08).
 */

export {
  evaluate,
  matchesPattern,
  parsePolicyYaml,
  loadPolicyFromFile,
  type PolicyDecision,
  type PolicyDecisionResponse,
  type PolicyRuleset,
  type ProposedAction,
  type EvaluationContext,
  type ActionClassification,
  type AuditConfig,
  type ComplianceTag,
  type ReversibilityLevel,
  type ScopeLevel,
  type SensitivityLevel,
} from './policy-engine.js';

export {
  verifyIntent,
  verifyIntentBatch,
  type IntentClassification,
  type IntentVerdict,
  type IntentVerification,
  type SessionContext,
} from './intent-verifier.js';
