/**
 * @borjie/autonomy-governance
 *
 * Per-tenant autonomy-caps + per-sub-MD quality SLOs + auto-rollback +
 * canary controller + handoff queue. The Klarna-defense substrate.
 *
 * R1 + R3 architectural framing: sub-MDs are *scoped, reversible task
 * contracts* — not autonomous juniors. Every contract is gated by:
 *
 *   1. A tenant-wide autonomy cap   (caps/)
 *   2. A per-(subMd, metric) SLO    (slo/sub-md-slo.ts)
 *   3. A canary stage ladder        (slo/canary-controller.ts)
 *   4. An auto-rollback engine      (slo/auto-rollback.ts)
 *   5. A handoff-to-human queue     (handoff/)
 *
 * This package is wire-agnostic: all I/O is delegated to ports. The
 * kernel-side hook that calls `evaluateAutonomyCap` before any mutate-tier
 * action is a follow-up — out of scope for this substrate wave.
 */

export * from './types.js';

// Caps
export {
  parseCapPolicy,
  defaultCap,
  capPolicySchema,
  evaluateAutonomyCap,
  type CapPolicyInput,
  type TenantAutonomyCapStore,
  type AutonomyRollingStateStore,
} from './caps/tenant-autonomy-cap.js';

// SLO
export {
  parseSubMdSlo,
  subMdSloSchema,
  computeDelta,
  isLowerBetterMetric,
  type SubMdSloInput,
} from './slo/sub-md-slo.js';
export {
  evaluateSlo,
  subscribeSloStream,
  type SloMonitorOptions,
  type SloResolver,
  type SloStreamConsumer,
  type SloWindowBuffer,
  type SubscribeSloStreamArgs,
} from './slo/slo-monitor.js';
export {
  STAGE_TRAFFIC_SHARE,
  stageIndex,
  demoteStage,
  promoteStage,
  shouldRouteToCanary,
} from './slo/canary-controller.js';
export {
  executeAutoRollback,
  type AutoRollbackDeps,
  type AutoRollbackInput,
  type CanaryStageStore,
  type HandoffQueuePort,
  type SubMdRevertPort,
} from './slo/auto-rollback.js';

// Handoff
export {
  InMemoryHandoffQueue,
  type HandoffQueueReader,
} from './handoff/handoff-queue.js';
export {
  handoffToHuman,
  type HandoffRequest,
  type HandoffDeps,
} from './handoff/handoff-to-human.js';

// Constitution (Anthropic CAI v3 + OpenAI Deliberative Alignment pattern).
// Twelve frozen clauses cite-and-reason-from before any tenant-affecting
// action. Citation verifier blocks `severity:refuse` clauses absent
// proper rationale; warn surfaces; inform disclaims.
export {
  BORJIE_CONSTITUTION_V1,
  clausesForAction,
  clausesForJurisdiction,
  renderConstitutionAsContext,
  getClause,
  applicableClauses,
  verifyResponse,
  renderAuditTrace,
  getClauseById,
  type ClauseSeverity,
  type Jurisdiction,
  type ClauseCitation,
  type ConstitutionClause,
  type VerifyInput,
  type VerifyVerdict,
  type ClauseResult,
} from './constitution/index.js';

// Probes — sleeper-agent + alignment-faking detection
// (Hubinger 2024 arXiv 2401.05566, Apollo 2024-2025, Anthropic 2025
// monitorability + EU AI Act Art.15(4)). Loose-coupled to the
// killswitch via the `KillswitchTrigger` interface — the wire-side
// composition root supplies the adapter that calls the actual
// platform/tenant killswitch writer.
export {
  probe as defectionProbe,
  probeWithJudge as defectionProbeWithJudge,
  runDefectionProbeAndMaybeTrip,
  renderProbeAsContext as renderDefectionProbeAsContext,
  DEFAULT_KILLSWITCH_CONFIDENCE as DEFAULT_DEFECTION_KILLSWITCH_CONFIDENCE,
  DEFECTION_DIAGNOSTIC_PROMPTS,
  type DefectionContributor,
  type DefectionLlmJudge,
  type DefectionProbeInput,
  type DefectionProbeScores,
  type DefectionVerdict,
  type KillswitchTrigger,
  type RunDefectionProbeArgs,
  type RunDefectionProbeResult,
} from './probes/defection-probe.js';
export {
  scoreAlignmentProbePair,
  aggregateAlignmentProbe,
  runAlignmentProbeAndMaybeTrip,
  renderAlignmentProbeAsContext,
  DEFAULT_EVAL_FRAMING,
  DEFAULT_DEPLOY_FRAMING,
  DEFAULT_KILLSWITCH_CONFIDENCE as DEFAULT_ALIGNMENT_FAKING_KILLSWITCH_CONFIDENCE,
  type AlignmentBand,
  type AlignmentProbeAggregate,
  type AlignmentProbePair,
  type AlignmentProbeVerdict,
  type ContrastPairResult,
  type ContrastPairRunInput,
  type ContrastPairRunner,
  type RunAlignmentProbeArgs,
  type RunAlignmentProbeResult,
} from './probes/alignment-faking-probe.js';
export {
  shouldProbeThisTurn,
  recordKillswitchTrip,
  INITIAL_PROBE_SAMPLER_STATE,
  DEFAULT_DEFECTION_SAMPLER_CONFIG,
  DEFAULT_DEFECTION_WITH_JUDGE_SAMPLER_CONFIG,
  DEFAULT_ALIGNMENT_FAKING_SAMPLER_CONFIG,
  type ProbeSamplerConfig,
  type ProbeSamplerState,
  type ProbeSamplingStrategy,
  type ShouldProbeDeps,
  type ShouldProbeResult,
} from './probes/probe-sampler.js';

// Routing — confidence-band gate (Klarna-fingerprint defense).
// Pure routing primitive — persistence + audit-queue wiring is a follow-up.
export {
  route as routeByConfidence,
  TIER_DEFAULTS as ROUTING_TIER_DEFAULTS,
  SPEC_DEFAULT_THRESHOLDS as ROUTING_SPEC_DEFAULT_THRESHOLDS,
  type Band as RoutingBand,
  type RouteDecision as RoutingDecision,
  type TenantTier as RoutingTenantTier,
  type TierThresholds as RoutingTierThresholds,
} from './routing/index.js';

// Shadow — shadow-mode-then-convert cutover gate. Pure scoring + gate
// logic (agreement + Pearson confidence correlation + critical-violation
// count + sample-size). See `.audit/litfin-sota-2026-05-23/
// 10-outcome-as-a-service.md` §2.3 — Sequoia-tracked: 85%+ cutover
// success vs 5% direct-pilot baseline. Migration + shadow-runner are
// downstream concerns.
export {
  DEFAULT_CUTOVER_CRITERIA,
  computeAgreementRate,
  countCriticalViolations,
  isEquivalent as isShadowDecisionEquivalent,
  computeConfidenceCorrelation,
  pearson as pearsonCorrelation,
  evaluate as evaluateCutoverGate,
  type CutoverCriteria,
  type CutoverCriterionResult,
  type CutoverResult,
  type DecisionKind as ShadowDecisionKind,
  type ShadowDecision,
  type ShadowSession,
} from './shadow/index.js';

// Policy — YAML-driven deny-by-default tool/DB/network gate + intent
// verifier (SQL-injection / data-exfil / prompt-injection-in-args).
// Ported from LITFIN (`src/core/security/policy-engine.ts` +
// `intent-verifier.ts`). See
// `.audit/litfin-sota-2026-05-23/03-security-governance.md` (SC-08).
// Worker-thread isolation deferred to a follow-up wave.
export {
  evaluate as evaluatePolicy,
  matchesPattern as matchesPolicyPattern,
  parsePolicyYaml,
  loadPolicyFromFile,
  verifyIntent,
  verifyIntentBatch,
  type PolicyDecision,
  type PolicyDecisionResponse,
  type PolicyRuleset,
  type ProposedAction as ProposedPolicyAction,
  type EvaluationContext as PolicyEvaluationContext,
  type ActionClassification as PolicyActionClassification,
  type AuditConfig as PolicyAuditConfig,
  type ComplianceTag as PolicyComplianceTag,
  type ReversibilityLevel as PolicyReversibilityLevel,
  type ScopeLevel as PolicyScopeLevel,
  type SensitivityLevel as PolicySensitivityLevel,
  type IntentClassification,
  type IntentVerdict,
  type IntentVerification,
  type SessionContext as IntentSessionContext,
} from './policy/index.js';

// Decision — continuous, per-decision autonomy controller. The frontier
// replacement for the 1-bit gated/auto switch (ORCHESTRATION_FRONTIER_
// ADDENDUM §"Confidence × consequence × reversibility-adaptive delegation
// gated on conformal calibration"). ADDITIVE overlay: `composeWithRail`
// guarantees rail-gate ALWAYS wins and the controller may only escalate.
// `calibratedConfidenceFromConformal` reuses @borjie/conformal-calibration-
// online / calibration-monitor to calibrate the confidence input before
// it is allowed to drive delegation.
export {
  decideAutonomy,
  moreCautious as moreCautiousAutonomyDecision,
  isAtLeastAsCautious as isAtLeastAsCautiousAutonomyDecision,
  DEFAULT_AUTO_CONFIDENCE_FLOORS,
  composeWithRail,
  calibratedConfidenceFromConformal,
  calibratedCoverageCeiling,
  type RailOutcome,
  type ComposedAutonomyOutput,
  type ConformalCoverageView,
  type AutonomyDecision,
  type ConsequenceTier as AutonomyConsequenceTier,
  type Reversibility as AutonomyReversibility,
  type DelegationMandate,
  type SituationFlags as AutonomySituationFlags,
  type DecideAutonomyInput,
  type DecideAutonomyOutput,
} from './decision/index.js';

// Sovereign-claim — defence-in-depth on the sovereign tier-elevation
// gate (LP-14). An HMAC-signed claim tying (userId, role, mfaVerifiedAt,
// scope) plus a recent-MFA freshness window, so a stolen cookie or
// role-string alone cannot mint a sovereign action. Ported from LITFIN
// `src/core/governance/tier-policy/sovereign-claim.ts`, re-skinned to
// mining (royalty / licence / payout / kill-switch scopes) and made a
// pure leaf via an injected CryptoPort. Wire `assertSovereignClaim()`
// BEFORE the tier-policy check on every sovereign tool.
export {
  SOVEREIGN_SCOPES,
  DEFAULT_MAX_AGE_MS as SOVEREIGN_DEFAULT_MAX_AGE_MS,
  DEFAULT_SOVEREIGN_ROLE,
  CLOCK_SKEW_TOLERANCE_MS as SOVEREIGN_CLOCK_SKEW_TOLERANCE_MS,
  SovereignClaimDenied,
  signSovereignClaim,
  assertSovereignClaim,
  tryVerifySovereignClaim,
  type CryptoPort as SovereignCryptoPort,
  type SovereignScope,
  type SovereignClaim,
  type SovereignClaimVerifyOptions,
  type SovereignClaimError,
  type SovereignClaimResult,
} from './sovereign-claim/index.js';
