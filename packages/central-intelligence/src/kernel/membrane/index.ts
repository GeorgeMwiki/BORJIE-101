/**
 * R7 — Proof-carrying membrane. Public surface.
 *
 * The unified, refuse-by-default verifier that EVERY higher-rung action /
 * self-edit passes through, emitting a signed, hash-chained safety
 * certificate. Today wired in SHADOW mode (computes + emits + logs
 * divergence; never enforces) so it changes zero allow/deny behavior. A
 * later validated wave flips it to enforce once shadow data proves zero
 * divergence.
 *
 *   - certificate.ts — the SafetyCertificate proof object + pure builder.
 *   - gatekeeper.ts  — the composed verifier (delegates to existing rails).
 *   - shadow.ts      — the behavior-preserving emit-and-log-only hook.
 */

export {
  SAFETY_INVARIANT_NAMES,
  InvariantResultSchema,
  SafetyVerdictSchema,
  SafetyCertificateSchema,
  computeVerdict,
  buildCertificate,
  GENESIS_HASH,
  type SafetyInvariantName,
  type InvariantResult,
  type SafetyVerdict,
  type SafetyCertificate,
  type BuildCertificateInput,
} from './certificate.js';

export {
  createGatekeeper,
  type Gatekeeper,
  type GatekeeperDeps,
  type GatekeeperAction,
  type GatekeeperEvaluateOptions,
  type PolicyGateStatusPort,
  type InviolableStatusPort,
  type KillswitchLevelPort,
  type TenantScopeConsistentPort,
  type EvidenceChainPort,
  type LocalePurePort,
  type EgressCleanPort,
  type KAnonPort,
  type NoRailMutationPort,
} from './gatekeeper.js';

export {
  runShadowGatekeeper,
  type ShadowGatekeeperDeps,
  type RunShadowGatekeeperInput,
  type SafetyCertificateSink,
  type DivergenceReporter,
  type ShadowDivergenceEvent,
  type ExistingDecisionOutcome,
} from './shadow.js';
