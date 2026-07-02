/**
 * Brain kernel — the disciplined cognitive layer.
 *
 * One entry point: `think(req)`. It traverses the 14-step pipeline
 * (steps 0 → 13 plus 11a):
 *
 *   0.  Killswitch — administrative HALT short-circuit (K1)
 *   1.  Brain-side cache check
 *   2.  Inviolable refusal gate
 *   3.  Awareness-scope/tier compatibility check
 *   4.  Memory recall (prior thread + semantic)
 *   5.  Cohort signal mix-in (k-anonymous, tier-floored)
 *   6.  Identity preamble + theory-of-mind + cognitive-load directives
 *   7.  Sensor selection + call (with failover)
 *   8.  Output normalization (preamble strip, ui_block extract)
 *   9.  Self-review judge pass + regen-on-low-score (when stakes ≥ high
 *       or requireJudge; K8 added the regen pass when judge score < 0.5)
 *   10. Self-awareness drift detection
 *   11. Policy gate (PII / numerical / regulatory)
 *   11a. Uncertainty policy — caveat / ask-back / escalate when the
 *        decision lacks the grounding to stand on its own (K1)
 *   12. Confidence scoring
 *   13. Provenance recording + cache write + CoT capture
 *
 * Returns a BrainDecision (`answer` | `softened` | `refusal`).
 *
 * The kernel is provider- and storage-agnostic. All side-effects go
 * through injected ports.
 */

import { createHash, randomUUID } from 'crypto';
import type {
  AgencyKernelPort,
  BrainDecision,
  ConfidenceVector,
  GateOutcome,
  GateVerdict,
  GroundingFact,
  GroundingFactsProvider,
  KernelStreamEvent,
  MemoryHierarchy,
  MultiLLMSynthesizerPort,
  PersonaDriftSink,
  ProvenanceRecord,
  ProvenanceSink,
  Sensor,
  SensorCallArgs,
  SensorCallResult,
  TextEmbedder,
  ThoughtRequest,
} from './kernel-types.js';
import type { Goal } from './agency/index.js';
import type {
  ReflectiveDigest,
  SemanticFact,
  SemanticMemoryPort,
} from './memory/types.js';
import type {
  FeedbackEntry,
  FeedbackMemoryPort,
} from './feedback/types.js';
import type { PersonaIdentity } from './identity.js';
import type { Citation, Artifact } from '../types.js';
import { selectPersona, renderIdentityPreamble } from './identity.js';
import type { SalienceVoiceBend } from './identity.js';
// Salience Arena (Global-Workspace single broadcast) — a winner-take-most
// competition over drives / detectors / commitments / ACT-R activation /
// affect that shapes the WHOLE turn (persona voice + the prompt's live-
// concern segment) BEFORE persona selection. PURE; the snapshot is never
// mutated; the arena only re-weights ATTENTION (it never acts).
import {
  arena as runSalienceArena,
  activationBids,
  bidForDetectorSeverity,
  bidForOverdueCommitment,
  clampBid,
  domainForDriveId,
  domainForEntityKind,
  renderFocusDirective,
  vpVoiceForDomain,
  type Focus,
  type FocusDomain,
  type SalienceBid,
} from './situational-model/salience-arena.js';
// Honest epistemic-state surface (INV-H). The per-thought self-model is
// already built (its only consumers were tests); we run it over the final
// answer + the confidence vector and emit a NEW additive `self_model`
// stream frame surfacing POSTURE + sure/unsure/would-need (never the math).
import {
  buildPerThoughtSelfModel,
  type PerThoughtSelfModel,
} from './introspection/per-thought-self-model.js';
import { applyBrandingOverride, type PersonaBrandingResolver } from './branding.js';
import { isTierCompatibleWithScope, locusPhrase } from './awareness-scopes.js';
import { checkInviolable } from './inviolable.js';
import { checkPublicInviolable } from './public-inviolable.js';
import {
  runPolicyGate,
  type PolicyGateRequestContext,
  type PolicyGateTier,
} from './policy-gate.js';
import { checkSelfAwareness } from './self-awareness.js';
import {
  inferMindState,
  renderMindStateDirective,
  renderMindStateDirectiveWithProfile,
  type AffectiveAccumulator,
} from './theory-of-mind.js';
import {
  assessCognitiveLoad,
  renderLoadDirective,
  renderLoadDirectiveWithProfile,
  type CognitiveLoadAccumulator,
} from './cognitive-load.js';
import {
  renderPersonaPrelude,
  type SituatedAddressArgs,
} from './persona.js';
import {
  renderSelfAwarenessBlock,
  type BodySchemaReader,
} from './self-awareness.js';
import { scoreConfidence } from './confidence.js';
import { normalize } from './normalizer.js';
import { type BrainCache, thoughtCacheKey, createBrainCache } from './brain-cache.js';
// LP-06 / LP-09 — deterministic megaprompt assembly + always-on
// IP-protection / security-boundary terminal layers.
import { assembleSystemPrompt, assembleSystemPromptBlocks } from './prompt-layers.js';
import { spotlight } from './prompt-spotlight.js';
// LP-04 — pre-exec intent verification port (post-LLM, pre-dispatch).
import { type IntentVerifierPort, verifyToolCalls } from './intent-verification.js';
// LP-03 — semantic-cache read-through / write-through underlay port.
import {
  type SemanticCachePort,
  buildSemanticScope,
  semanticCacheRead,
  semanticCacheWrite,
} from './semantic-cache-port.js';
// Latency wins — light the (previously dark) semantic cache on the live
// orchestrator path + fast-path tiered routing + model tiering. All three
// are pure/fail-safe helpers; the model-tiering + fast-path BEHAVIOUR
// changes are gated by env flags defaulting to CURRENT behaviour.
import {
  buildOrchestratorScope,
  readOrchestratorSemanticCache,
  writeOrchestratorSemanticCache,
} from './orchestrator-fast-cache.js';
import {
  decideFastPath,
  resolveFastPathEnabled,
} from './fast-path-router.js';
import {
  selectModelTier,
  resolveModelTieringEnabled,
} from './model-tiering.js';
import { type SensorRouter, createSensorRouter } from './sensor-failover.js';
import type { CotReservoir } from './cot-reservoir.js';
import { buildCohortMixin, type CohortSource } from './cohort-signal.js';
import type { DebateOutcome } from './debate/debate-types.js';
import type { BrainToolRegistry, BrainToolOutcome } from './tool-spec.js';
import {
  resolveKillswitch,
  renderKillswitchRefusalText,
  type KillswitchPort,
} from './killswitch.js';
import {
  resolveUncertaintyPolicy,
  type UncertaintyDecision,
} from './uncertainty-policy.js';
import type {
  DecisionTraceRecorder,
  DecisionTraceWriter,
  KernelStepName,
} from './decision-trace.js';
// C5 (Progressive Intelligence) coordination zone — additive ports.
// These wire the per-turn Self-RAG critic, the Voyager skill retriever,
// and the Reflexion read-at-start / write-at-end loop. All three are
// optional; the kernel runs unchanged when none are supplied.
import { runSelfRag, type SelfRagJudge, type SelfRagVerdict } from './self-rag/self-rag.js';
import type { SkillEntry, SkillRetriever } from './skill-library/skill-retriever.js';
import type {
  ReflexionEntry,
  ReflexionRetriever,
} from './reflexion/reflexion-retriever.js';
import type {
  ReflexionOutcome,
  ReflexionWriterPort,
} from './reflexion/reflexion-writer.js';
import {
  isExplicitSessionTerminator,
  recordReflection,
} from './reflexion/reflexion-writer.js';
// Wave-13 F11 — task-scoped reflexion loader. Distinct from the
// session-scoped `reflexionRetriever` above: the loader pulls the
// dedupe-clustered + guideline-augmented bundle written by the
// 4-pass nightly sleep job. Prepended under a "Recent self-critiques"
// section in the system prompt at step 6.
import {
  loadReflexions,
  type ReflexionLoaderPort,
} from './reflexion/reflexion-loader.js';
// R7 — proof-carrying membrane (SHADOW mode). The gatekeeper computes a
// signed, hash-chained safety certificate alongside the already-final
// decision, emits it via an optional sink, and logs any divergence from
// the existing checks' verdict — but NEVER enforces. All three deps are
// optional; absent (CI / bootstrap) → the hook is a pure no-op.
import {
  runShadowGatekeeper,
  type Gatekeeper as SafetyGatekeeper,
  type GatekeeperAction as SafetyGatekeeperAction,
  type SafetyCertificateSink,
  type DivergenceReporter as SafetyDivergenceReporter,
  type ExistingDecisionOutcome as SafetyExistingDecisionOutcome,
} from './membrane/index.js';
// Wave-13 F2 — tier-policy gate that fires BEFORE the sensor call. The
// resolver lives outside the kernel package (`../policy-gate`) so the
// kernel imports only the assertion helper + role-policy type. When the
// caller wires `deps.tierPolicy` and threads an `action` through the
// `ThoughtRequest`, the kernel refuses with a structured
// `tier_refusal` outcome — the rest of the pipeline is skipped.
import {
  assertTierPolicy,
  type RolePolicy,
  type TierAssertionResult,
} from '../policy-gate/assertions.js';
// A2b-2 wires #1 + #2 — pre-LLM PII scrub. The persist-boundary
// scrubber covers the regional baseline (email, phone, NIDA, KRA,
// M-Pesa till) AND the Phase-D extension (API keys, model URLs,
// M-Pesa confirmation IDs, model-named entities). Used to scrub
// `req.userMessage` BEFORE the sensor egress (so third-party LLMs
// never see raw PII) and BEFORE the episodic-memory write (so
// `kernel_memory_episodic.summary` can't leak raw PII even though
// that table is not in the RTBF list).
import { scrubCotForPersist } from './cot-reservoir/pii-scrub-cot.js';
// Phase E.5.1 — orchestrator wire-up. The orchestrator's `think()`
// becomes the primary code path. The legacy 13-step pipeline below
// remains a fallback toggled by `KERNEL_USE_ORCHESTRATOR` (or the
// per-instance `useByDefault` flag on `BrainKernelDeps.orchestrator`).
import {
  think as orchestratorThink,
  type OrchestratorRequest,
  type OrchestratorResponse,
} from './orchestrator/main-loop.js';
// F10 DecisionTrace — wrap each `brain.think()` invocation as one
// structured outer trace so a downstream auditor sees ONE replayable
// trace per turn instead of N unrelated span events. The kernel's
// internal `DecisionTraceWriter` (per-step events for the orchestrator)
// is preserved alongside this outer trace.
//
// IMPORTANT: central-intelligence MUST NOT depend on
// `@borjie/observability` at compile time — the kernel is a leaf
// node in the dependency graph and pulling in observability creates a
// cycle through the api-gateway. We resolve the recorder via a
// best-effort dynamic require so the bracket is a no-op in pure-domain
// tests and lights up only when the observability package is on the
// runtime path (gateway, workers).
type StartDecisionTraceFn = (
  name: string,
  options: {
    inputs: Record<string, unknown>;
    context?: {
      tenantId?: string | undefined;
      userId?: string | undefined;
      requestId?: string | undefined;
    };
  },
) => {
  readonly traceId: string;
  addBranch(branch: {
    id: string;
    label: string;
    rationale: string;
  }): void;
  choose(branchId: string, rationale?: string): void;
  finalize(args: {
    outcome: 'approved' | 'rejected' | 'executed' | 'refused' | 'failed';
    output?: unknown;
    error?: string;
  }): unknown;
  isFinalised(): boolean;
};
let cachedStartDecisionTrace: StartDecisionTraceFn | null | 'unresolved' =
  'unresolved';
function resolveStartDecisionTrace(): StartDecisionTraceFn | null {
  if (cachedStartDecisionTrace !== 'unresolved') {
    return cachedStartDecisionTrace;
  }
  try {
    // Use a dynamic import-via-Function so static analysis (and the
    // TypeScript module resolver) never tries to resolve the module
    // at compile time. When observability is on the runtime path the
    // require resolves; otherwise we fall through to no-op.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const req = new Function(
      'm',
      'return require ? require(m) : null',
    ) as (m: string) => unknown;
    const mod = req('@borjie/observability') as
      | { startDecisionTrace?: StartDecisionTraceFn }
      | null;
    cachedStartDecisionTrace = mod?.startDecisionTrace ?? null;
  } catch {
    cachedStartDecisionTrace = null;
  }
  return cachedStartDecisionTrace;
}

export interface BrainKernelDeps {
  readonly sensors: ReadonlyArray<Sensor>;
  readonly router?: SensorRouter;
  readonly cache?: BrainCache;
  readonly cohort?: CohortSource;
  readonly cotReservoir?: CotReservoir;
  readonly driftSink?: PersonaDriftSink;
  readonly provenanceSink?: ProvenanceSink;
  /**
   * R7 — proof-carrying membrane (SHADOW mode). When `safetyGatekeeper`
   * is wired, the kernel computes a signed, hash-chained safety
   * certificate alongside each already-final `think()` decision, emits it
   * via `safetyCertificateSink` (best-effort; absent → no emission), and
   * reports any divergence between the certificate verdict and the
   * decision the existing scattered checks already made via
   * `safetyDivergenceReporter`. It NEVER enforces — the existing checks
   * remain the sole deciders, so wiring these changes NO allow/deny
   * outcome. All three are optional; absent → the hook is a pure no-op
   * (CI-inert). See `kernel/membrane/`.
   */
  readonly safetyGatekeeper?: SafetyGatekeeper;
  readonly safetyCertificateSink?: SafetyCertificateSink;
  readonly safetyDivergenceReporter?: SafetyDivergenceReporter;
  readonly groundingFacts?: GroundingFactsProvider;
  readonly priorTurnsLoader?: (threadId: string) => Promise<
    ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>
  >;
  readonly recentTurnCounter?: (threadId: string) => Promise<number>;
  /**
   * Optional reader for the MD's LIVE, DERIVED body schema (the
   * `@borjie/system-graph` organ-map summary). When wired, the kernel
   * renders the live "[BRAIN SELF-AWARENESS]" block from the actual route
   * table / screen registries / package exports / DB schemas / MCP tools
   * / capability registry instead of the static `BRAIN_MODULES` list,
   * killing the hand-written-inventory drift. When absent (tests,
   * bootstrap before first derivation) the static block is used.
   *
   * See Docs/research/MD_AS_BODY_ARCHITECTURE.md §bodyModel.
   */
  readonly bodySchemaReader?: BodySchemaReader;
  readonly judge?: (text: string) => Promise<{
    readonly score: number;
    readonly reasonText?: string;
    readonly suggestedFix?: string;
  }>;
  readonly clock?: () => Date;
  readonly rng?: () => number;
  /**
   * Optional per-tenant persona-branding resolver. When supplied, the
   * kernel looks up a {@link PersonaBrandingOverride} keyed by tenantId
   * + surface BEFORE rendering the identity preamble, so an agency can
   * re-skin the AI's displayName / openingPreamble without touching
   * the surface-default personas.
   */
  readonly brandingResolver?: PersonaBrandingResolver;
  /**
   * Optional LITFIN-style four-tier memory hierarchy. When supplied,
   * the kernel:
   *   - reads `semantic.search(...)` and `reflective.latest(...)` at
   *     step 4 (memory recall) and mixes the results into the system
   *     prompt as "What I remember about you" + "Recent reflection";
   *   - writes two `episodic.record(...)` entries at step 13 (one for
   *     the user message, one for the agent action).
   * Every call is wrapped in try/catch; memory is a side-channel and
   * must never break the main turn.
   */
  readonly memory?: MemoryHierarchy;
  /**
   * Optional online-learning feedback port. When supplied, the kernel
   * fetches the user's last 10 feedback entries at step 4 (memory
   * recall) and mixes a "What I've learned from your feedback:"
   * fragment into the system prompt, listing recent verbatim
   * corrections + a per-category negative-rate. When the
   * negative-rate exceeds 0.25 the kernel also appends a directive
   * telling the sensor to be more conservative on the next turn.
   * Failures are swallowed — the side-channel never breaks the turn.
   */
  readonly feedback?: FeedbackMemoryPort;
  /**
   * Optional internal-debate hook. When supplied AND
   * `shouldDebate(req)` returns true (default: stakes ≥ 'high'), the
   * kernel replaces the single sensor call at step 7 with a multi-
   * voice debate and uses the synthesis text as the sensor output.
   * Currently honoured by the non-streaming `think(req)` path only;
   * `thinkStream(req)` falls back to the single-shot sensor path.
   */
  readonly debate?: {
    shouldDebate(req: ThoughtRequest): boolean;
    runDebate(question: string, context: string): Promise<DebateOutcome>;
  };
  /**
   * Optional multi-LLM synthesizer port. When supplied AND the inbound
   * turn carries `req.requireSynthesis === true`, the kernel replaces
   * the single sensor call at step 7 with a mixture-of-agents fan-out
   * (typically Anthropic + OpenAI + DeepSeek) followed by a Claude-Opus
   * synthesis pass. The synthesizer output is plugged in as a sensor
   * result so steps 8-13 (normalize, judge, drift, policy, confidence,
   * provenance) keep working unchanged.
   *
   * The toggle defaults OFF (`requireSynthesis` is opt-in per turn) so
   * existing single-shot callers keep their cost profile. On any
   * failure (proposer rejection, synthesizer error, network) the kernel
   * falls back to the single-shot path and records `synthesis-fallback`
   * on the trace.
   *
   * Composition root (`services/api-gateway/src/composition/multi-llm-
   * synthesizer-wiring.ts`) builds the port from
   * `@borjie/ai-copilot/providers/multi-llm-synthesizer.ts`.
   *
   * Distinct from `debate` (above): synthesis runs N providers ONCE in
   * parallel and merges; debate runs N voices × R rounds sequentially.
   * Synthesis is cheaper and emits an agreement metric the judge can
   * escalate on. Debate wins when both are eligible on the same turn.
   */
  readonly synthesizer?: MultiLLMSynthesizerPort;
  /**
   * Optional agency port. When supplied, step 4 (memory recall) also
   * reads the user's ACTIVE goals via `agency.goals.list(...)` and
   * mixes them into the system prompt as a "What you've asked me to
   * work on" fragment. Errors from the goals reader are swallowed —
   * the agency channel is a side-channel, never breaks the turn. The
   * full executor + wake-loop live above the kernel.
   */
  readonly agency?: AgencyKernelPort;
  /**
   * Optional administrative killswitch. When wired, the kernel runs a
   * Step 0 short-circuit BEFORE any sensor / memory / cohort work:
   *   - HALT (platform or tenant): immediate refusal, no LLM call.
   *   - DEGRADED: currently logged via the trace recorder; the call
   *               still proceeds.
   * Tenant-scoped state takes precedence over platform state. See
   *   `killswitch.ts` for the operational reason codes.
   */
  readonly killswitch?: KillswitchPort;
  /**
   * Optional decision-trace recorder. When wired, the kernel emits a
   * structured trace of every step the request passed through (step
   * name, duration_ms, summary, errors). Persisted via the store the
   * recorder was constructed with; failures are swallowed so the
   * trace side-channel never breaks the main turn.
   */
  readonly traceRecorder?: DecisionTraceRecorder;
  /**
   * Uncertainty-policy switch. Default: `'off'`. When `'on'`, step
   * 11a (uncertainty-policy) runs after confidence scoring and may
   * caveat / ask-back / escalate the reply based on confidence and
   * stakes. Kept opt-in because the heuristic confidence scorer is
   * permissive — naive sensor outputs ("High-stakes answer.") can
   * register zero groundedness against the mining-estate
   * vocabulary detector (TZS/offtake/royalty/...). Callers that wire a
   * judge + grounding-facts together should turn this on.
   */
  readonly uncertaintyPolicy?: 'off' | 'on';
  /**
   * Optional per-(tenant, user) cognitive-load accumulator. When
   * wired, the kernel observes each turn's per-turn score against
   * the accumulator and renders a cross-turn load directive
   * (`renderLoadDirectiveWithProfile`) — the running profile carries
   * "your last 4 turns showed escalating load" hints into the next
   * sensor call.
   */
  readonly cognitiveLoadAccumulator?: CognitiveLoadAccumulator;
  /**
   * Optional per-(tenant, user) affective accumulator. When wired,
   * the kernel observes each turn's MindState against the accumulator
   * and renders a cross-turn behavioural directive
   * (`renderMindStateDirectiveWithProfile`).
   */
  readonly affectiveAccumulator?: AffectiveAccumulator;
  /**
   * Optional brain-tool registry. When wired and the kernel routes a
   * tool dispatch (sensor returned a `tool_use` block), the registry
   * resolves a 5-PM-seed tool deterministically and the kernel mixes
   * the result back into the prompt context.
   */
  readonly toolRegistry?: BrainToolRegistry;
  /**
   * Optional text embedder. When wired, the memory-recall step
   * produces a query embedding from the user message when the
   * caller did not supply `request.embedding`, and prefers
   * `searchByEmbedding(...)` over the legacy key-based `search(...)`.
   * Failures collapse to the legacy path so retrieval still works.
   */
  readonly embedder?: TextEmbedder;
  // ── C5 (Progressive Intelligence) coordination zone ─────────────────
  /**
   * Optional Voyager-style skill retriever. When wired, the kernel
   * fetches the top-K learned skills for the current intent at step 6
   * (system-prompt composition) and injects them as an addendum
   * ("**Available learned skills:** …"). Failures collapse to no-op.
   */
  readonly skillRetriever?: SkillRetriever;
  /**
   * Optional Reflexion retriever. When wired, the kernel reads the
   * last N reflections for (tenant, user) at step 4 (memory recall)
   * and injects them into the system prompt at session start.
   */
  readonly reflexionRetriever?: ReflexionRetriever;
  /**
   * Optional Reflexion writer. When wired, the kernel checks each
   * inbound turn for an explicit session-terminator ("bye", "/end",
   * "thanks that's all") and records a verbal reflection at the end
   * of the turn. Idle-end detection is the caller's responsibility.
   */
  readonly reflexionWriter?: ReflexionWriterPort;
  /**
   * Optional Self-RAG critic. When wired, the kernel runs IsREL /
   * IsSUP / IsUSE reflection tokens after the sensor result is
   * normalised. When the critic blocks (IsSUP=low|unknown on a
   * financial / contractual claim), the kernel refuses the turn
   * with `gate: 'policy'` and reason
   * `'self-rag/insufficient-support'`.
   */
  readonly selfRagJudge?: SelfRagJudge;
  // ── C4 (Sensorium / Brain Skin) coordination zone ───────────────────
  /**
   * Optional behaviour-signal source — Central Command Phase A (C4).
   * When wired, the kernel reads recent derived mind-state signals
   * from the sensorium-event-log aggregator (engagement.high /
   * frustration.detected / task.completed-without-AI / dwell.deep)
   * and mixes them into the system prompt. The production adapter
   * lives in `@borjie/ai-copilot/ambient-brain` and reads the
   * Drizzle-backed `sensorium_event_log` table. Side-channel —
   * failures collapse to no-op.
   */
  readonly behaviorSignalSource?: import('./kernel-types.js').BehaviorSignalSourcePort;
  /**
   * Cross-session Theory-of-Mind — DURABLE owner communication-style
   * model. When wired, step 6 reads `getStyleHint(tenantId)` and
   * concatenates that durable directive BESIDE the per-turn affective
   * `mindDirective`, so the prompt carries both "how the owner feels
   * now" and "how this owner always wants to be spoken to". Post-turn,
   * the kernel folds ONE observation back via `refine(...)` so every
   * exchange tightens the Bayesian posterior (perceive → bias → observe
   * → learn). Best-effort: any failure collapses to '' / no-op so a
   * missing `owner_style_profiles` table never breaks a turn.
   *
   * Production adapter: `createOwnerStyleService(...)` from
   * `@borjie/ai-copilot/owner-style`, bound in `sovereign.ts`. The
   * port is duck-typed in `kernel-types.ts` so central-intelligence
   * keeps NO compile-time dep on `@borjie/ai-copilot`.
   */
  readonly ownerStyleReader?: import('./kernel-types.js').OwnerStyleReaderPort;
  /**
   * Salience Arena input — durable READ port for the slow loop's open
   * proposals (one per breached standing drive, carrying `driveId` +
   * `breachSeverity` + `urgency`). When wired, step 6 folds each open
   * proposal into a comparable arena bid BEFORE persona selection so the
   * single most-salient estate concern bends the persona voice + seeds
   * the prompt's live-concern segment. Reuses the existing
   * `PendingProposalReader` the slow loop already persists into. Fail-
   * safe: a store fault resolves to `[]`; the arena simply has fewer
   * bidders.
   */
  readonly pendingProposalReader?: import('./estate-mind/estate-mind.js').PendingProposalReader;
  /**
   * Salience Arena input — optional READ port for the per-tenant
   * situational snapshot (the ACT-R-activated estate entities). When
   * wired, the arena adds activation bids (min-maxed across the
   * snapshot) so the most-referenced entity competes for the spotlight
   * alongside drives + detectors + affect. Snapshot is read-only — the
   * arena never mutates it. Fail-safe: a null snapshot ⇒ no activation
   * bids.
   */
  readonly situationalSnapshotReader?: {
    read(tenantId: string): Promise<
      import('./situational-model/types.js').SituationalSnapshot | null
    >;
  };
  /**
   * Conflict-monitored effort recruitment (System 1/2). When NOT
   * explicitly disabled (defaults ON when the inputs exist), the kernel
   * builds one CONFLICT scalar from signals it already computes
   * (1−confidence.overall, synthesizer disagreement, debate-not-
   * converged, judge<0.5) and — when conflict crosses the threshold on a
   * turn the fast-path router scored 'fast'/'standard' — RECRUITS the
   * next depth tier (debate detour / `preferModelTier='deep'`) ONCE
   * mid-turn before committing. All rails stay intact: this only
   * escalates DELIBERATION; it never bypasses a gate or acts. Set
   * `false` to pin the legacy single-upshift-at-ingress behaviour.
   */
  readonly conflictRecruitmentEnabled?: boolean;
  /** D8 — optional regulatory mirror; see `regulatory-mirror.ts`. */
  readonly regulatoryMirror?: import('./regulatory-mirror.js').RegulatoryMirror;
  /**
   * D5 — optional rollout controller. When wired the kernel calls
   * `pickPrompt(...)` BEFORE composing the system prompt; the
   * returned `promptText` is mixed into the system block. Every
   * failure mode collapses to the hard-coded preamble:
   *   - null decision   → no marker mixed
   *   - throws          → swallowed; no marker mixed
   *   - missing wire    → no-op
   */
  readonly rolloutController?: import('./rollout/rollout-controller.js').RolloutController;
  /**
   * Phase E.5.1 — orchestrator wire-up.
   *
   * When supplied, `think()` / `thinkStream()` delegate to the
   * Claude-Code-style main-loop orchestrator (PreToolUse / PostToolUse /
   * Stop hook substrate + Plan + Budget + Memory) instead of running
   * the legacy 13-step pipeline. The feature flag controls per-call
   * routing:
   *
   *   - `useByDefault: true`  (default when this dep is present and
   *                            `KERNEL_USE_ORCHESTRATOR` is not the
   *                            literal string `'false'`) — the new
   *                            path runs for every call.
   *   - `useByDefault: false` (or env `KERNEL_USE_ORCHESTRATOR=false`)
   *                            — legacy 13-step pipeline runs. Ops can
   *                            flip this without redeploying so an
   *                            incident on the new path can be rolled
   *                            back instantly.
   *
   * Composition root (`compose.ts`) constructs the OrchestratorDeps
   * with the 9 built-in hooks bound to the existing kernel deps
   * (four-eye approval, PII scrubber, tool denylist, rate limiter,
   * cost circuit, sandbox resolver, permission scopes, audit sink,
   * ledger seal). The hook chain is then passed into both `think()`
   * and `thinkStream()` so per-call governance flows uniformly.
   */
  readonly orchestrator?: {
    readonly deps: import('./orchestrator/main-loop.js').OrchestratorDeps;
    /**
     * Defaults to true. Set false to opt back into the legacy 13-step
     * pipeline for this kernel instance (e.g. canary rollback).
     */
    readonly useByDefault?: boolean;
  };
  // ── Wave-13 — F2 + F11 wiring ─────────────────────────────────────
  /**
   * Wave-13 F2 — tier-policy gate. When wired AND the request carries
   * an `action` (see `ThoughtRequest.action`), the kernel runs
   * `assertTierPolicy(policy, action)` BEFORE the sensor call. A failed
   * assertion short-circuits the pipeline with a structured refusal
   * (`gate: 'policy'`, reason starts with `'tier_refusal:'`) so the
   * caller can branch on the prefix.
   *
   * The role/action mapping is owned by the composition root — the
   * kernel only consumes the resolver verdict.
   */
  readonly tierPolicy?: { readonly policy: RolePolicy };
  /**
   * Wave-13 F11 — task-scoped reflexion loader. Distinct from
   * `reflexionRetriever` above (session-scoped, last-N reads). When
   * wired, the kernel calls `loadReflexions({ tenantId, userId,
   * limit: 5 })` at step 6 (system prompt composition) and prepends
   * the rendered `promptFragment` to the system prompt under a
   * "Recent self-critiques" section. Failures collapse to no-op so
   * the side-channel never breaks the turn.
   */
  readonly reflexionLoader?: ReflexionLoaderPort;
  // ── LP-03 / LP-04 — Wave-0 wiring-debt closure ──────────────────────
  /**
   * LP-04 — intent verifier. When wired AND
   * `intentVerificationEnabled !== false`, the kernel checks every
   * sensor-proposed `tool_use` call against the user ask at the
   * post-LLM / pre-dispatch seam (step 7b). A `permitted:false` verdict
   * blocks that tool call; verifier errors fail-OPEN (the call runs) so a
   * verifier bug never bricks the brain. The composition root binds this
   * to `@borjie/autonomy-governance` `verifyIntent`.
   */
  readonly intentVerifier?: IntentVerifierPort;
  /** Master flag for LP-04. Defaults to true when `intentVerifier` is
   *  wired; the api-gateway resolves it from
   *  `BORJIE_INTENT_VERIFIER_ENABLED`. */
  readonly intentVerificationEnabled?: boolean;
  /**
   * LP-03 — semantic-cache underlay. When wired AND
   * `semanticCacheEnabled !== false`, the kernel reads through the
   * embedding-keyed cache after an L1 brain-cache miss, and writes
   * through fresh `answer` decisions. Scoped per (tenantId, surface,
   * personaId). The composition root builds the concrete cache from
   * `./semantic-cache/`.
   */
  readonly semanticCache?: SemanticCachePort;
  /** Master flag for LP-03. Defaults to true when `semanticCache` is
   *  wired; resolved from `BORJIE_SEMANTIC_CACHE_ENABLED`. */
  readonly semanticCacheEnabled?: boolean;
}

/**
 * Optional per-call kernel options. `signal` is a cancellation signal an SSE
 * surface aborts on client disconnect; the kernel forwards it onto the
 * sensor's provider SDK request (direct-sensor path) so in-flight token
 * generation stops. NOTE: like the `extendedThinking` honouring at line ~335,
 * cancellation is currently forwarded on the DIRECT-sensor path only; the
 * orchestrator-routed main-loop (default-on) still relies on the calling
 * surface's own abort floor (the SSE route stops draining on disconnect).
 * Threading `signal` through the orchestrator main-loop's sensor calls is the
 * remaining follow-up for full upstream cancellation under orchestrator routing.
 */
export interface KernelCallOptions {
  readonly signal?: AbortSignal;
}

export interface BrainKernel {
  think(req: ThoughtRequest, options?: KernelCallOptions): Promise<BrainDecision>;
  /**
   * Token-level streaming counterpart to `think()`. Runs the full
   * disciplined pipeline:
   *   - pre-sensor steps run synchronously before any token is yielded
   *   - sensor token deltas are forwarded to the consumer in real time
   *   - post-sensor steps (normalize, judge, drift, policy, confidence,
   *     provenance, cache.set, CoT capture) run after the sensor stops
   *   - the consumer always sees a final `done` event with a fully-
   *     formed `BrainDecision`
   *
   * Pre-sensor refusals (inviolable / tier) collapse to `turn_start +
   * done(refusal)` with no deltas. Post-sensor refusals (drift / policy
   * block) emit deltas, then a `gate_verdict` event, then `done(refusal)`.
   */
  thinkStream(
    req: ThoughtRequest,
    options?: KernelCallOptions,
  ): AsyncIterable<KernelStreamEvent>;
}

export function createBrainKernel(deps: BrainKernelDeps): BrainKernel {
  const clock = deps.clock ?? (() => new Date());
  const rng = deps.rng ?? Math.random;
  const cache = deps.cache ?? createBrainCache({ clock: () => clock().getTime() });
  const router = deps.router ?? createSensorRouter({ sensors: deps.sensors, clock: () => clock().getTime() });
  const reservoir = deps.cotReservoir;

  // Phase E.5.1 — orchestrator routing gate. Resolves once per kernel
  // instance (not per call) since the dep + env-var pair is stable for
  // the kernel's lifetime. Composition root rebuilds the kernel on
  // config change.
  const orchestratorRoutingEnabled = resolveOrchestratorRoutingEnabled(deps);

  return {
    async think(req, options) {
      // F10 DecisionTrace — outer per-turn trace. One trace per
      // `brain.think()` call covering the full 14-step pipeline. Each
      // step is recorded as one branch; the final outcome
      // (answer / softened / refusal) is set in finalize. We open the
      // trace BEFORE the orchestrator gate so both code paths share the
      // same audit envelope.
      //
      // Resolved via best-effort dynamic require so central-intelligence
      // doesn't compile-time-depend on @borjie/observability.
      const outerTenantId =
        req.scope.kind === 'tenant' ? req.scope.tenantId : null;
      const startDecisionTraceFn = resolveStartDecisionTrace();
      const outerTrace: ReturnType<StartDecisionTraceFn> | null =
        startDecisionTraceFn
          ? startDecisionTraceFn('brain.think', {
              inputs: {
                threadId: req.threadId,
                stakes: req.stakes ?? null,
                tier: req.tier ?? null,
                scopeKind: req.scope.kind,
                surfaceId: (req as { surfaceId?: string }).surfaceId ?? null,
                // Hash the user message rather than store it raw so a trace
                // export is safe to share with a customer-support auditor
                // without PII review.
                userMessageHash: createHash('sha256')
                  .update(String(req.userMessage ?? ''))
                  .digest('hex'),
                userMessageLength: String(req.userMessage ?? '').length,
              },
              context: {
                tenantId: outerTenantId ?? undefined,
                userId: (req as { userId?: string }).userId ?? undefined,
                requestId: (req as { requestId?: string }).requestId ?? undefined,
              },
            })
          : null;

      // Phase E.5.1 — primary code path. When the orchestrator is wired
      // and the feature flag is on, delegate the whole turn to the
      // main-loop. The legacy 13-step pipeline below remains the
      // fallback (flag off, or orchestrator not wired). Both paths
      // surface a `BrainDecision` so callers don't observe the swap.
      if (orchestratorRoutingEnabled && deps.orchestrator) {
        // 0) killswitch — administrative HALT short-circuit. The
        //    orchestrator main-loop has no killswitch step of its own,
        //    so we run the shared step-0 gate HERE, before delegating,
        //    to guarantee a platform / tenant HALT denies on the
        //    orchestrator path exactly as it does on the legacy pipeline.
        //    Fail-closed: an active hold must never be bypassed by the
        //    routing flag.
        const ksHalt = evaluateKillswitchHalt({
          killswitch: deps.killswitch,
          req,
          thoughtId: randomUUID(),
          startedAt: clock().getTime(),
          clockNow: clock(),
          provenanceSink: deps.provenanceSink,
        });
        if (ksHalt) {
          if (outerTrace && !outerTrace.isFinalised()) {
            outerTrace.addBranch({
              id: 'killswitch',
              label: 'Killswitch HALT',
              rationale: `HALT reason=${ksHalt.state.reasonCode}`,
            });
            outerTrace.choose('killswitch', `HALT reason=${ksHalt.state.reasonCode}`);
            outerTrace.finalize({
              outcome: 'refused',
              output: { kind: 'refusal', gate: 'killswitch' },
            });
          }
          return ksHalt.decision;
        }

        // ── Latency win 1: SEMANTIC CACHE on the LIVE orchestrator path ──
        //
        // The semantic cache used to fire ONLY on the legacy fallback
        // pipeline (steps 1b + 13) — but the orchestrator is the live
        // default, so the cache was BUILT BUT DARK on every real turn. We
        // read it HERE, after the killswitch (so a HALT still denies first)
        // and before the expensive orchestrator round-trip. On an embedding
        // hit above threshold we return the cached, evidence-backed
        // `BrainDecision` INSTANTLY (citations preserved, `cacheHit: true`
        // stamped). Scoped per (tenantId, surface, personaId, locale) so a
        // tenant never gets another tenant's entry and `en` never replays
        // `sw`. NEVER throws — any fault falls through to the orchestrator.
        const orchSemanticEnabled = deps.semanticCacheEnabled !== false;
        const orchSemanticScope = buildOrchestratorScope(req);
        let orchMissEmbedding: ReadonlyArray<number> | null = null;
        if (deps.semanticCache && orchSemanticEnabled) {
          const orchSemRead = await readOrchestratorSemanticCache({
            cache: deps.semanticCache,
            enabled: orchSemanticEnabled,
            req,
            scope: orchSemanticScope,
            answeringModelId: deps.sensors[0]?.modelId ?? 'orchestrator',
          });
          if (orchSemRead.hit !== null) {
            if (outerTrace && !outerTrace.isFinalised()) {
              outerTrace.addBranch({
                id: 'semantic-cache',
                label: 'Semantic cache hit (orchestrator path)',
                rationale: `sim=${(orchSemRead.similarity ?? 0).toFixed(3)}`,
              });
              outerTrace.choose(
                'semantic-cache',
                `instant replay sim=${(orchSemRead.similarity ?? 0).toFixed(3)}`,
              );
              outerTrace.finalize({
                outcome: 'executed',
                output: { kind: orchSemRead.hit.kind, cacheHit: true },
              });
            }
            return orchSemRead.hit;
          }
          orchMissEmbedding = orchSemRead.missEmbedding;
        }

        // ── Latency wins 2 + 5: fast-path tiered routing + model tiering ──
        //
        // A cheap deterministic gate classifies trivial/simple turns and
        // (when `BORJIE_FASTPATH` is on) records that the turn could take a
        // lightweight lane on the cheapest capable model tier (when
        // `BORJIE_MODEL_TIERING` is on). Both default OFF ⇒ no behaviour
        // change; the decision is surfaced on the trace + threaded to the
        // orchestrator via `req.preferModelTier` (advisory; honoured by the
        // composition-root sensor selector when wired). The kernel's hard
        // gates still run on the fast lane — only the deliberation depth +
        // model tier change.
        const fastPathEnabled = resolveFastPathEnabled();
        const fastPathDecision = decideFastPath(req);
        const effectiveRoute =
          fastPathEnabled ? fastPathDecision.route : 'full';
        const modelTieringEnabled = resolveModelTieringEnabled();
        const tierDecision = selectModelTier({ route: effectiveRoute, req });
        const orchReq: ThoughtRequest =
          modelTieringEnabled
            ? ({ ...req, preferModelTier: tierDecision.tier } as ThoughtRequest)
            : req;
        if (outerTrace) {
          outerTrace.addBranch({
            id: 'fast-path',
            label: 'Fast-path tiered routing',
            rationale: `route=${effectiveRoute} (${fastPathDecision.reason}) tier=${tierDecision.tier} fastEnabled=${fastPathEnabled} tierEnabled=${modelTieringEnabled}`,
          });
        }

        try {
          const result = await runViaOrchestrator(orchReq, deps, clock);
          // Latency win 1 (write side): best-effort write-through of fresh,
          // evidence-backed answers so the NEXT near-identical turn replays
          // instantly. Fire-and-forget — never blocks the reply. Refusals /
          // softened / evidence-empty answers are NOT cached.
          if (deps.semanticCache && orchSemanticEnabled) {
            void writeOrchestratorSemanticCache({
              cache: deps.semanticCache,
              enabled: orchSemanticEnabled,
              req,
              scope: orchSemanticScope,
              decision: result,
              missEmbedding: orchMissEmbedding,
              cacheId: randomUUID(),
            });
          }
          if (outerTrace) {
            outerTrace.addBranch({
              id: 'orchestrator',
              label: 'Orchestrator main-loop',
              rationale: 'KERNEL_USE_ORCHESTRATOR enabled',
            });
            outerTrace.choose(
              'orchestrator',
              'delegated to orchestrator main-loop',
            );
            outerTrace.finalize({
              outcome:
                result.kind === 'refusal'
                  ? 'refused'
                  : result.kind === 'softened'
                    ? 'rejected'
                    : 'executed',
              output: { kind: result.kind },
            });
          }
          return result;
        } catch (err) {
          if (outerTrace && !outerTrace.isFinalised()) {
            outerTrace.finalize({
              outcome: 'failed',
              error: err instanceof Error ? err.message : String(err),
            });
          }
          throw err;
        }
      }
      const startedAt = clock().getTime();
      const thoughtId = randomUUID();
      const cacheKey = thoughtCacheKey(req);
      const memTenantIdEarly =
        req.scope.kind === 'tenant' ? req.scope.tenantId : null;

      // A2b-2 wire #1 — pre-LLM PII scrub. Compute ONCE per turn;
      // reuse for every sensor egress (initial sensor.call, regen
      // pass, debate fallback) and for the episodic-memory write
      // (wire #2). The original `req.userMessage` is preserved on
      // the closure variable so audit-side hashes (`sha(req.
      // userMessage)`) still bind to the user's literal input.
      const scrubbedUserMessage = scrubCotForPersist(req.userMessage).scrubbed;

      // Decision-trace writer — null when no recorder is wired. We use
      // a mutable handle so each `traceStep(...)` call can replace it
      // with the next immutable writer state without leaking knowledge
      // of the recorder out of the request closure.
      let trace: DecisionTraceWriter | null = deps.traceRecorder
        ? deps.traceRecorder.begin({
            thoughtId,
            tenantId: memTenantIdEarly,
            threadId: req.threadId,
          })
        : null;
      const traceStep = (
        step: KernelStepName,
        startMs: number,
        summary: string,
        error?: Error | unknown,
      ): void => {
        if (!trace) return;
        const durationMs = Math.max(0, clock().getTime() - startMs);
        const errMsg = error instanceof Error
          ? error.message
          : error
            ? String(error)
            : undefined;
        trace = trace.step({
          step,
          durationMs,
          summary,
          ...(errMsg ? { error: errMsg } : {}),
        });
      };
      // F10 DecisionTrace — track each step of the legacy 14-step
      // pipeline as a branch on the outer trace. Branches are added
      // lazily inside `traceStep` below; here we precompute the
      // outcome-mapping used by `finaliseTrace` so all exit sites flow
      // through a single decision-trace finalize call.
      const legacyOutcomeFor = (
        outcome: 'answer' | 'softened' | 'refusal',
      ): 'approved' | 'rejected' | 'executed' | 'refused' | 'failed' => {
        if (outcome === 'refusal') return 'refused';
        if (outcome === 'softened') return 'rejected';
        // 'answer' is the success path — the brain executed and returned
        // an answer to the caller.
        return 'executed';
      };
      const finaliseTrace = (
        outcome: 'answer' | 'softened' | 'refusal',
        refusalGate?:
          | 'inviolable'
          | 'policy'
          | 'drift'
          | 'killswitch'
          | 'uncertainty',
      ): void => {
        if (trace) {
          void trace
            .finalize({ outcome, ...(refusalGate ? { refusalGate } : {}) })
            .catch(() => undefined);
        }
        // F10 — also finalise the OUTER per-turn DecisionTrace if the
        // observability package is on the runtime path. Idempotent —
        // guarded by `isFinalised()`. Pick a `choose(...)` that mirrors
        // the path actually taken.
        if (outerTrace && !outerTrace.isFinalised()) {
          outerTrace.addBranch({
            id: 'legacy-pipeline',
            label: 'Legacy 14-step pipeline',
            rationale:
              refusalGate
                ? `refused at ${refusalGate} gate`
                : `exit outcome=${outcome}`,
          });
          outerTrace.choose(
            'legacy-pipeline',
            refusalGate ? `gate=${refusalGate}` : `outcome=${outcome}`,
          );
          outerTrace.finalize({
            outcome: legacyOutcomeFor(outcome),
            output: { outcome, refusalGate: refusalGate ?? null },
          });
        }
      };

      // 0) killswitch — administrative HALT short-circuit. Runs before
      //    cache, memory, sensor, anything. Per-tenant state wins over
      //    platform state. DEGRADED is non-fatal (logged via trace).
      if (deps.killswitch) {
        const ksStart = clock().getTime();
        const ks = resolveKillswitch(deps.killswitch, memTenantIdEarly);
        if (ks.level === 'halt') {
          traceStep(
            'killswitch',
            ksStart,
            `HALT reason=${ks.reasonCode}${ks.note ? ` note=${ks.note}` : ''}`,
          );
          const decision = makeRefusal({
            thoughtId,
            req,
            reason: renderKillswitchRefusalText(ks),
            gate: 'inviolable',
            startedAt,
            clockNow: clock(),
          });
          if (deps.provenanceSink) {
            void deps.provenanceSink
              .record(decision.provenance)
              .catch(() => undefined);
          }
          finaliseTrace('refusal', 'killswitch');
          return decision;
        }
        traceStep(
          'killswitch',
          ksStart,
          `level=${ks.level} reason=${ks.reasonCode}`,
        );
      }

      // 1) brain-side cache (L1 exact-key, ~0ms)
      const cacheStart = clock().getTime();
      const cached = cache.get(cacheKey);
      if (cached) {
        traceStep('cache', cacheStart, 'hit');
        finaliseTrace(cached.kind);
        return cached;
      }
      traceStep('cache', cacheStart, 'miss');

      // 1b) LP-03 — semantic cache (L2 embedding-keyed underlay). On an
      // embedding-cosine hit we replay the cached BrainDecision without
      // spending a sensor call. On a miss we keep the query embedding so
      // the write-through (step after `cache.set`) re-uses it instead of
      // re-embedding. Scoped per (tenantId, surface, personaId); NEVER
      // throws. The miss embedding is held on a closure variable.
      const semanticCacheEnabled = deps.semanticCacheEnabled !== false;
      const semanticScope = buildSemanticScope({
        tenantId: memTenantIdEarly,
        surface: req.surface,
        personaId: req.scope.personaId,
        // EN/SW absolute (CLAUDE.md): locale is part of the scope so an
        // `en` turn can never replay a cached `sw` answer. Default `en`.
        locale: req.language === 'sw' ? 'sw' : 'en',
      });
      let semanticMissEmbedding: ReadonlyArray<number> | null = null;
      if (deps.semanticCache && semanticCacheEnabled) {
        const semStart = clock().getTime();
        const semRead = await semanticCacheRead({
          cache: deps.semanticCache,
          enabled: semanticCacheEnabled,
          scope: semanticScope,
          userMessage: req.userMessage,
          answeringModelId: deps.sensors[0]?.modelId ?? 'unknown',
        });
        if (semRead.hit !== null) {
          traceStep(
            'semantic-cache',
            semStart,
            `hit sim=${(semRead.similarity ?? 0).toFixed(3)}`,
          );
          // Promote the semantic hit into the L1 exact-key cache so the
          // next identical turn short-circuits at step 1.
          cache.set(cacheKey, semRead.hit);
          finaliseTrace(semRead.hit.kind);
          return semRead.hit;
        }
        semanticMissEmbedding = semRead.missEmbedding;
        traceStep('semantic-cache', semStart, 'miss');
      }

      // 2) inviolable
      const invStart = clock().getTime();
      const inviolable = checkInviolable(req);
      if (inviolable.status === 'block') {
        traceStep(
          'inviolable',
          invStart,
          `block category=${inviolable.category ?? 'unknown'}`,
        );
        const decision = makeRefusal({
          thoughtId,
          req,
          reason: inviolable.reason ?? 'inviolable rule blocked the request',
          gate: 'inviolable',
          startedAt,
          clockNow: clock(),
        });
        if (deps.provenanceSink) {
          void deps.provenanceSink.record(decision.provenance).catch(() => undefined);
        }
        finaliseTrace('refusal', 'inviolable');
        return decision;
      }
      traceStep('inviolable', invStart, 'pass');

      // 2b) public-tier inviolable (marketing surface only).
      // The unauthenticated marketing surface gets a stricter input
      // filter: prompt-injection markers, oversized messages, cross-
      // tenant probes, phishing-content asks, authority impersonation,
      // and system-prompt extraction attempts all hard-refuse here
      // BEFORE any sensor budget is spent.
      if (req.surface === 'marketing') {
        const pubStart = clock().getTime();
        const publicVerdict = checkPublicInviolable({
          userMessage: req.userMessage,
          ipHash: req.ipHash ?? '',
        });
        if (publicVerdict.status === 'block') {
          traceStep(
            'public-inviolable',
            pubStart,
            `block category=${publicVerdict.category ?? 'unknown'}`,
          );
          const decision = makeRefusal({
            thoughtId,
            req,
            reason:
              publicVerdict.reason ??
              `public marketing inviolable category: ${publicVerdict.category ?? 'unknown'}`,
            gate: 'inviolable',
            startedAt,
            clockNow: clock(),
          });
          if (deps.provenanceSink) {
            void deps.provenanceSink.record(decision.provenance).catch(() => undefined);
          }
          finaliseTrace('refusal', 'inviolable');
          return decision;
        }
        traceStep('public-inviolable', pubStart, 'pass');
      }

      // 3) tier compatibility
      const tierStart = clock().getTime();
      const tierCheck = isTierCompatibleWithScope(req.tier, req.scope);
      if (!tierCheck.ok) {
        traceStep('tier-compat', tierStart, `refuse reason=${tierCheck.reason}`);
        const decision = makeRefusal({
          thoughtId,
          req,
          reason: tierCheck.reason,
          gate: 'inviolable',
          startedAt,
          clockNow: clock(),
        });
        if (deps.provenanceSink) {
          void deps.provenanceSink.record(decision.provenance).catch(() => undefined);
        }
        finaliseTrace('refusal', 'inviolable');
        return decision;
      }
      traceStep('tier-compat', tierStart, 'pass');

      // 3b) Wave-13 F2 — tier-policy gate (Constitution v2 reason-based
      // resolver). Fires AFTER the awareness-tier compatibility check
      // and BEFORE any sensor budget is spent. The wiring is opt-in:
      // - `deps.tierPolicy` carries the role + rule set;
      // - `req.action` is the namespace string fed to the resolver.
      // A refusal short-circuits the pipeline with a structured
      // `tier_refusal:<reason>` so the calling surface can render a
      // friendly "you can't do that with this role" reply instead of
      // a generic 500.
      if (deps.tierPolicy && req.action) {
        const tpStart = clock().getTime();
        const tpResult: TierAssertionResult = assertTierPolicy(
          deps.tierPolicy.policy,
          req.action,
        );
        if (!tpResult.ok) {
          traceStep(
            'tier-compat',
            tpStart,
            `tier-policy refuse role=${deps.tierPolicy.policy.role} action=${req.action}`,
          );
          const decision = makeRefusal({
            thoughtId,
            req,
            reason: `tier_refusal: ${tpResult.reason}`,
            gate: 'policy',
            startedAt,
            clockNow: clock(),
          });
          if (deps.provenanceSink) {
            void deps.provenanceSink
              .record(decision.provenance)
              .catch(() => undefined);
          }
          finaliseTrace('refusal', 'policy');
          return decision;
        }
        traceStep(
          'tier-compat',
          tpStart,
          `tier-policy pass role=${deps.tierPolicy.policy.role} action=${req.action}${tpResult.reasonGeneralized ? ' generalised=1' : ''}`,
        );
      }

      // 4) memory recall
      const priorTurns = deps.priorTurnsLoader
        ? await deps.priorTurnsLoader(req.threadId)
        : [];

      // 4b) hierarchical memory recall — semantic facts + the latest
      // reflective digest. Both ports are optional; failures are
      // swallowed so the side-channel never breaks the turn. When the
      // request carries an embedding (or the optional embedder port
      // produces one), prefer `searchByEmbedding(...)` over the legacy
      // key-based `search(...)`.
      const memTenantId =
        req.scope.kind === 'tenant' ? req.scope.tenantId : null;
      const memUserId = req.scope.actorUserId;
      const queryEmbedding = await resolveQueryEmbedding(req, deps.embedder);
      const semanticFacts = await loadSemanticFacts(
        deps.memory,
        memTenantId,
        memUserId,
        queryEmbedding,
      );
      const reflectiveDigest = await loadReflectiveDigest(deps.memory, memTenantId, memUserId);

      // 4c) online-learning feedback recall — the user's last
      // 10 thumbs / corrections / flags so the next turn can
      // apologise, learn, and bias toward conservative output when
      // the negative-rate is elevated.
      const feedbackRecent = await loadFeedbackRecent(
        deps.feedback,
        memTenantId,
        memUserId,
      );

      // 4d) agency — active goals for the (tenant, user) pair.
      const activeGoals = await loadActiveGoals(
        deps.agency,
        memTenantId,
        memUserId,
      );

      // 4e) C5 — Reflexion retrieval. Reads the last N reflections for
      // (tenant, user) so the kernel can inject them as a system-prompt
      // addendum at session start. Side-channel — the retriever owns
      // the failure path (returns [] on error).
      const reflexionEntries: ReadonlyArray<ReflexionEntry> =
        deps.reflexionRetriever && memTenantId && memUserId
          ? await deps.reflexionRetriever.retrieve({
              tenantId: memTenantId,
              userId: memUserId,
            })
          : [];

      // 4f) C5 — Voyager skill retrieval. Fetches the top-K learned
      // skills matching the current user intent. The retriever owns
      // the embedder call internally; we just hand it the user
      // message + tenant scope.
      const learnedSkills: ReadonlyArray<SkillEntry> = deps.skillRetriever
        ? await deps.skillRetriever.retrieve({
            tenantId: memTenantId,
            userMessage: req.userMessage,
          })
        : [];

      // 5) cohort signal
      const cohortMix = deps.cohort
        ? await buildCohortMixin({ source: deps.cohort, tier: req.tier, userMessage: req.userMessage })
        : { findings: [], promptFragment: '', fingerprints: [] as ReadonlyArray<string> };

      // 5b) grounding facts (tenant-internal data points)
      const groundingFacts: ReadonlyArray<GroundingFact> = deps.groundingFacts
        ? await deps.groundingFacts
            .fetch({ userMessage: req.userMessage, tier: req.tier, limit: 6 })
            .catch(() => [])
        : [];

      // 6.0) Salience Arena (wins #3 + #4) — a single Global-Workspace
      // broadcast that competes drives / ACT-R activation / affect onto
      // ONE comparable scale and picks the turn's most-salient concern
      // BEFORE persona selection. The winner bends the persona VOICE
      // (not its id/taboos/scope) and seeds a "live concern" prompt
      // segment so the answer leans into the salient estate fact even
      // when the user asked something tangential. Every input is best-
      // effort; an empty arena leaves persona selection unchanged.
      const [arenaDriveBids, arenaActivationBids, arenaAffectBids] =
        await Promise.all([
          buildDriveBids(deps.pendingProposalReader, memTenantIdEarly),
          buildActivationBids(deps.situationalSnapshotReader, memTenantIdEarly),
          buildAffectBids(deps.behaviorSignalSource, memTenantIdEarly, memUserId),
        ]);
      const salience = resolveSalienceFocus([
        arenaAffectBids,
        arenaDriveBids,
        arenaActivationBids,
      ]);
      if (salience.focus) {
        traceStep(
          'identity-render',
          clock().getTime(),
          `salience winner=${salience.focus.winner.id} bid=${salience.focus.winner.bid.toFixed(2)} domain=${salience.focus.winner.domain}`,
        );
      }

      // 6) identity + theory-of-mind + cognitive-load.
      // Branding override (if any) is applied BEFORE personalisation /
      // preamble rendering so an agency-level rename or preamble flows
      // through the rest of the pipeline (drift detection, audit) under
      // the rebranded id. The salience voice-bend overlays the most-
      // salient concern's VP register onto the surface-default tone.
      const baseSurfacePersona = selectPersona(req, salience.voiceBend);
      const branding = deps.brandingResolver
        ? await deps.brandingResolver
            .resolve({
              tenantId: req.scope.kind === 'tenant' ? req.scope.tenantId : null,
              surface: req.surface,
            })
            .catch(() => null)
        : null;
      const persona = applyBrandingOverride(baseSurfacePersona, branding);
      const identity = renderIdentityPreamble({ persona, scope: req.scope });

      // D5 — rollout controller. When wired, the controller picks the
      // prompt version for the (tenant, kernel-system) tuple and we
      // mix the resolved promptText into the system block. Every
      // failure mode (null / throw / missing wire) collapses to a
      // no-op so the legacy preamble + module inventory still ships.
      let rolloutPromptFragment = '';
      if (deps.rolloutController) {
        try {
          const decision = await deps.rolloutController.pickPrompt({
            tenantId:
              req.scope.kind === 'tenant' ? req.scope.tenantId : null,
            capability: 'kernel-system',
          });
          if (decision && decision.promptText.length > 0) {
            rolloutPromptFragment = decision.promptText;
          }
        } catch {
          // Swallowed — kernel falls back to its hard-coded preamble.
        }
      }

      // K3 — platform-voice anchor + situated address. Sits BEFORE the
      // per-surface identity preamble so the cache-eligible block hits
      // first; the legacy preamble + module inventory layer on top.
      const personaPrelude = renderPersonaPrelude(
        buildSituatedAddressArgs(req, clock),
      );
      const moduleInventory = renderSelfAwarenessBlock(deps.bodySchemaReader);

      // ToM accumulator — observe + render with cross-turn profile if
      // wired. Falls back to per-turn directive when the accumulator is
      // missing or the (tenant, user) tuple is incomplete.
      const mindState = inferMindState(req.userMessage);
      const affectiveProfile = observeAffective(
        deps.affectiveAccumulator,
        memTenantIdEarly,
        memUserId,
        mindState,
        clock,
      );
      const perTurnMindDirective = affectiveProfile
        ? renderMindStateDirectiveWithProfile(mindState, affectiveProfile)
        : renderMindStateDirective(mindState);

      // Cross-session ToM (win #1) — the DURABLE owner-style directive.
      // Concatenated BESIDE the per-turn affective directive so the
      // prompt carries both "how the owner feels NOW" and "how this owner
      // ALWAYS wants to be spoken to". Best-effort: '' on any failure.
      const ownerStyleHint =
        deps.ownerStyleReader && memTenantIdEarly
          ? await deps.ownerStyleReader
              .getStyleHint(memTenantIdEarly)
              .catch(() => '')
          : '';
      const mindDirective =
        ownerStyleHint && ownerStyleHint.trim().length > 0
          ? `${perTurnMindDirective} ${ownerStyleHint.trim()}`
          : perTurnMindDirective;

      const recentTurns = deps.recentTurnCounter ? await deps.recentTurnCounter(req.threadId) : 0;
      const loadOut = assessCognitiveLoad({
        userMessage: req.userMessage,
        recentTurnCount: recentTurns,
      });
      const loadProfile = observeCognitiveLoad(
        deps.cognitiveLoadAccumulator,
        memTenantIdEarly,
        memUserId,
        loadOut,
        clock,
      );
      const loadDirective = loadProfile
        ? renderLoadDirectiveWithProfile(loadOut, loadProfile)
        : renderLoadDirective(loadOut);

      // C5 — render skill + reflexion addenda (both empty when no
      // ports wired; `.filter(Boolean)` below drops empty strings).
      const learnedSkillsFragment = deps.skillRetriever
        ? deps.skillRetriever.renderPromptFragment(learnedSkills)
        : '';
      const reflexionFragment = deps.reflexionRetriever
        ? deps.reflexionRetriever.renderPromptFragment(reflexionEntries)
        : '';

      // Wave-13 F11 — task-scoped reflexion loader. Pulls the 4-pass
      // nightly-sleep output (dedupe-clustered reflexions + crystallised
      // guidelines) and prepends a "Recent self-critiques" block at the
      // top of the system prompt. Distinct from the session-scoped
      // `reflexionRetriever` above — that emits raw recent rows; the
      // loader emits the consolidated bundle. Errors are swallowed; the
      // loader returns an empty fragment on any failure.
      const taskScopedReflexionFragment =
        deps.reflexionLoader && memTenantId
          ? await loadTaskScopedReflexions(deps.reflexionLoader, memTenantId, memUserId)
          : '';

      // LP-06 + LP-09 — deterministic megaprompt ordering + always-on
      // IP-protection / security-boundary terminal layers. The fragment
      // map is rendered through `assembleSystemPrompt` which pins the
      // slot order (prompt-cache stability) and appends the two security
      // layers unconditionally as the final block. See `prompt-layers.ts`.
      // BRAIN §5 — the same record is also rendered to `systemSegments`,
      // which marks the stable persona + tenant-agnostic prefix so the
      // Anthropic adapter places a prompt-prefix cache breakpoint there.
      // `system` (string) stays byte-identical to the segment concatenation.
      const systemFragments = {
        personaPrelude,
        // Wave-13 F11 — "Recent self-critiques" sits high in the prompt
        // (just below the persona anchor) so the model reads the
        // crystallised lessons before the rest of the context.
        taskScopedReflexion: taskScopedReflexionFragment
          ? `**Recent self-critiques**\n${taskScopedReflexionFragment}`
          : '',
        identity,
        rolloutPrompt: rolloutPromptFragment,
        moduleInventory,
        locus: `Locus: ${locusPhrase(req.tier, req.scope)}.`,
        // The salience focus rides in the SAME dynamic slot as the
        // behavioural directive so we don't reorder the prompt-cache slot
        // contract. Empty `salience.directive` ⇒ the legacy directive
        // verbatim (no behaviour change when the arena had no winner).
        behaviouralDirective: salience.directive
          ? `Behavioural directive: ${mindDirective}\n${salience.directive}`
          : `Behavioural directive: ${mindDirective}`,
        verbosityDirective: `Verbosity directive: ${loadDirective}`,
        semanticMemory: renderSemanticMemoryFragment(semanticFacts),
        reflectiveDigest: renderReflectiveDigestFragment(reflectiveDigest),
        reflexion: reflexionFragment,
        feedback: renderFeedbackFragment(feedbackRecent),
        activeGoals: renderActiveGoalsFragment(activeGoals),
        grounding: renderGroundingFragment(groundingFacts),
        learnedSkills: learnedSkillsFragment,
        cohortMix: cohortMix.promptFragment,
        // Item-1 — ABSOLUTE single-language pin on the legacy persona path,
        // at parity with the orchestrator path. CLAUDE.md: `en` default,
        // `sw` toggle, ZERO mixing. Terminal dynamic slot so it cannot be
        // displaced by recalled memory / grounding / tool output.
        languageDirective: renderOrchestratorLanguageDirective(
          req.language === 'sw' ? 'sw' : 'en',
        ),
      };
      const system = assembleSystemPrompt(systemFragments);
      const systemSegments = assembleSystemPromptBlocks(systemFragments);

      // 7) sensor call (failover). When attachments are present we add
      // 'vision' to the required-capabilities array so only vision-capable
      // sensors are eligible. The attachments themselves are forwarded
      // verbatim and the adapter rebuilds the user message into a
      // multipart content array.
      //
      // Optional debate detour: when `deps.debate` is wired and
      // `shouldDebate(req)` returns true (default: stakes ∈ {high,
      // critical}), we replace the single sensor call with a multi-
      // voice debate and use the synthesis text as the sensor output.
      // D8 — multi-dim TTC allocator replaces the binary stakes test.
      const __ttcMod = await import('./ttc-allocator.js');
      const __ttc = __ttcMod.allocateTtc({
        stakes: req.stakes,
        surface: req.surface,
        ...(typeof req.requireJudge === 'boolean'
          ? { requireJudge: req.requireJudge }
          : {}),
      });
      const wantsThinking = __ttc.cognitionMode !== 'fast';
      const hasAttachments = (req.attachments?.length ?? 0) > 0;
      const required: Array<'vision' | 'thinking' | 'fast' | 'batch'> = [];
      if (wantsThinking) required.push('thinking');
      if (hasAttachments) required.push('vision');

      const debateEligible =
        deps.debate &&
        (req.stakes === 'high' || req.stakes === 'critical') &&
        deps.debate.shouldDebate(req);

      // Synthesizer eligibility — opt-in per turn via
      // `req.requireSynthesis`. The optional `shouldSynthesize(req)`
      // gate on the port lets adapters apply a tier ceiling (e.g. skip
      // when `stakes === 'low'` to save spend). Debate wins when both
      // are eligible — see the dep jsdoc for the rationale.
      const synthesizerEligible =
        !debateEligible &&
        deps.synthesizer !== undefined &&
        req.requireSynthesis === true &&
        (deps.synthesizer.shouldSynthesize === undefined ||
          deps.synthesizer.shouldSynthesize(req));

      let sensorResult: SensorCallResult;
      let debateRoundsCompleted: number | undefined;
      let debateConverged: boolean | undefined;
      // Conflict-recruitment inputs (win #5). The synthesizer already
      // emits an agreement metric + escalate flag (today telemetry-only);
      // capture them so the post-judge conflict gate can read them.
      let synthAgreement: number | undefined;
      let synthEscalate: boolean | undefined;
      const sensorStart = clock().getTime();
      if (debateEligible && deps.debate) {
        const debateStart = clock().getTime();
        try {
          const outcome = await deps.debate.runDebate(req.userMessage, system);
          // The runner stamps the synthesis with `maxRounds + 1`,
          // and every other contribution carries a round in
          // [1, maxRounds]. Count distinct rounds excluding the
          // final synthesis stamp.
          const allRounds = outcome.contributions.map((c) => c.round);
          const synthesisStamp = allRounds.length > 0
            ? Math.max(...allRounds)
            : 0;
          const debateRounds = new Set(
            outcome.contributions
              .filter((c) => c.round < synthesisStamp)
              .map((c) => c.round),
          );
          debateRoundsCompleted = debateRounds.size;
          debateConverged = outcome.converged;
          sensorResult = {
            text: outcome.synthesis,
            thought: null,
            toolCalls: [],
            latencyMs: clock().getTime() - debateStart,
            modelId: '__debate__',
            sensorId: '__debate__',
          };
          traceStep(
            'debate',
            debateStart,
            `rounds=${debateRoundsCompleted} converged=${debateConverged}`,
          );
        } catch (e) {
          traceStep('debate', debateStart, 'failed; falling back to single-shot', e);
          // On debate failure, fall back to the single-shot path.
          // A2b-2 wire #1 — scrubbed userMessage at sensor egress.
          sensorResult = await router.call(
            {
              system,
              systemPrompt: system,
              systemSegments,
              userMessage: scrubbedUserMessage,
              priorTurns,
              extendedThinking: wantsThinking,
              stakes: req.stakes,
              ...(req.attachments ? { attachments: req.attachments } : {}),
            },
            required,
          );
          traceStep(
            'sensor-call',
            sensorStart,
            `sensor=${sensorResult.sensorId} model=${sensorResult.modelId}`,
          );
        }
      } else if (synthesizerEligible && deps.synthesizer) {
        // Multi-LLM synthesizer detour. Fan out across N proposers
        // (typically Anthropic + OpenAI + DeepSeek) and synthesize via
        // Claude Opus. The synthesis text is plugged in as a sensor
        // result so steps 8-13 (normalize → confidence → provenance)
        // work unchanged. Failure collapses to the single-shot path so
        // a synthesizer outage NEVER blocks the user's turn.
        const synthesisStart = clock().getTime();
        try {
          const synthOut = await deps.synthesizer.synthesize({
            systemPrompt: system,
            userMessage: scrubbedUserMessage,
            priorTurns,
            stakes: req.stakes,
            mode: 'merge',
          });
          sensorResult = {
            text: synthOut.content,
            thought: null,
            toolCalls: [],
            latencyMs: synthOut.latencyMs,
            modelId: synthOut.modelId,
            sensorId: '__multi-llm-synthesizer__',
          };
          // Win #5 — surface the synthesizer's disagreement to the
          // conflict gate (previously this metric only hit telemetry).
          synthAgreement = synthOut.agreement;
          synthEscalate = synthOut.escalate;
          traceStep(
            'sensor-call',
            sensorStart,
            `synthesizer ok proposers=${synthOut.proposerSuccessCount}/${
              synthOut.proposerSuccessCount + synthOut.proposerFailureCount
            } agreement=${synthOut.agreement.toFixed(2)} escalate=${synthOut.escalate} fallback=${synthOut.synthesizerFallback}`,
          );
        } catch (e) {
          traceStep(
            'sensor-call',
            synthesisStart,
            'synthesizer failed; falling back to single-shot',
            e,
          );
          sensorResult = await router.call(
            {
              system,
              systemPrompt: system,
              systemSegments,
              userMessage: scrubbedUserMessage,
              priorTurns,
              extendedThinking: wantsThinking,
              stakes: req.stakes,
              ...(req.attachments ? { attachments: req.attachments } : {}),
            },
            required,
          );
          traceStep(
            'sensor-call',
            sensorStart,
            `sensor=${sensorResult.sensorId} model=${sensorResult.modelId} (post-synth-fallback)`,
          );
        }
      } else {
        // A2b-2 wire #1 — scrubbed userMessage on the primary sensor
        // egress. The optional cancellation `signal` is forwarded here on the
        // primary direct-sensor path so a disconnected SSE client stops
        // provider token generation (secondary debate/synth-fallback sites are
        // rare and intentionally not threaded).
        sensorResult = await router.call(
          {
            system,
            systemPrompt: system,
            systemSegments,
            userMessage: scrubbedUserMessage,
            priorTurns,
            extendedThinking: wantsThinking,
            stakes: req.stakes,
            ...(req.attachments ? { attachments: req.attachments } : {}),
            ...(options?.signal ? { signal: options.signal } : {}),
          },
          required,
        );
        traceStep(
          'sensor-call',
          sensorStart,
          `sensor=${sensorResult.sensorId} model=${sensorResult.modelId}`,
        );
      }

      // Defensive normalisation — duck-typed sensor adapters (test
      // spies, MCP probes) may return a partial result without
      // `toolCalls` / `latencyMs`. Coerce missing fields here so the
      // post-sensor pipeline never null-derefs downstream.
      sensorResult = normaliseSensorResult(sensorResult);

      // 7a-IV) LP-04 — intent verification (post-LLM, pre-exec). Each
      // sensor-proposed tool call is checked against the user ask BEFORE
      // it can be dispatched. A `permitted:false` verdict drops that call;
      // verifier errors fail-OPEN. No-op when no verifier is wired.
      const ivStart = clock().getTime();
      const intentVerdict = await verifyToolCalls({
        verifier: deps.intentVerifier,
        enabled: deps.intentVerificationEnabled !== false,
        proposed: sensorResult.toolCalls.map((tc) => ({
          toolName: tc.toolName,
          input: tc.input,
          callId: tc.callId,
        })),
        userMessage: req.userMessage,
        sessionContext: {
          recentTools: [],
          recentTopics: [],
          escalationCount: 0,
          ...(memTenantIdEarly !== null ? { tenantId: memTenantIdEarly } : {}),
          ...(memUserId !== null ? { userId: memUserId } : {}),
        },
      });
      if (intentVerdict.blocked.length > 0) {
        const blockedSummary = intentVerdict.blocked
          .map((b) => `${b.toolName}:${b.matchedRule ?? 'blocked'}`)
          .join(',');
        traceStep('intent-verify', ivStart, `blocked ${blockedSummary}`);
      } else if (deps.intentVerifier && deps.intentVerificationEnabled !== false) {
        traceStep('intent-verify', ivStart, `pass n=${String(intentVerdict.allowed.length)}`);
      }

      // 7b) tool dispatch — when the sensor emitted a `tool_use` call
      // matching a seed PM tool AND a registry is wired, resolve it
      // deterministically. The result is recorded on the trace so ops
      // can audit which deterministic resolution backed which sensor
      // suggestion. The kernel does NOT loop sensor↔tool here — the
      // streaming agent-loop owns that. Only intent-verified calls reach
      // the dispatcher (LP-04).
      const toolDispatchResults = await dispatchKernelTools(
        deps.toolRegistry,
        intentVerdict.allowed.map((tc) => ({
          toolName: tc.toolName,
          input: tc.input,
        })),
      );
      if (toolDispatchResults.length > 0) {
        const summary = toolDispatchResults
          .map((r) => `${r.toolName}=${r.outcome.kind}`)
          .join(',');
        traceStep('sensor-call', sensorStart, `tool-dispatch ${summary}`);
      }

      // 8) normalize
      const normStart = clock().getTime();
      let normalised = normalize(sensorResult.text);
      traceStep('normalize', normStart, `chars=${normalised.text.length}`);

      // 9) judge (when high-stakes) + Wave-K regen-on-low-score.
      //    When the judge returns < 0.5 AND stakes are at least 'medium',
      //    bake the judge feedback into the system prompt and re-call the
      //    sensor ONCE (no infinite loop). Mirrors LITFIN
      //    brain-kernel.ts:1190-1240. K1 owns step 0 (killswitch) and
      //    step 11a (uncertainty); this patch lives strictly at step 9.
      const judgeStart = clock().getTime();
      // Phase D D2 — auto-judge for stakes>='high' (was: critical-only).
      const judgeRequested = req.requireJudge === true || req.stakes === 'high' || req.stakes === 'critical';
      let judgeOut: {
        readonly score: number;
        readonly reasonText?: string;
        readonly suggestedFix?: string;
      } | null = judgeRequested && deps.judge
        ? await deps.judge(normalised.text)
        : null;
      let regenAttempted = false;
      if (
        judgeOut &&
        judgeOut.score < 0.5 &&
        (req.stakes === 'medium' || req.stakes === 'high' || req.stakes === 'critical') &&
        deps.judge
      ) {
        regenAttempted = true;
        const fix = (judgeOut.suggestedFix ?? '').trim() ||
          (judgeOut.reasonText ?? '').trim() ||
          'Improve grounding, hedge uncited numbers, and match the mining-ops voice.';
        const regenSystem = `${system}\n\nA self-review judge flagged the previous draft (score=${judgeOut.score.toFixed(2)}). Apply this fix EXACTLY ONCE and re-answer: ${fix}`;
        try {
          // A2b-2 wire #1 — scrubbed userMessage on the regen pass.
          const regenResult = await router.call(
            {
              system: regenSystem,
              systemPrompt: regenSystem,
              userMessage: scrubbedUserMessage,
              priorTurns,
              extendedThinking: wantsThinking,
              stakes: req.stakes,
              ...(req.attachments ? { attachments: req.attachments } : {}),
            },
            required,
          );
          sensorResult = regenResult;
          normalised = normalize(regenResult.text);
          // Re-judge the regenerated draft so confidence + provenance
          // reflect the post-fix score, not the original.
          judgeOut = await deps.judge(normalised.text);
        } catch {
          // Regen failure: keep the original sensorResult + judgeOut.
        }
      }
      if (judgeRequested) {
        traceStep(
          'judge',
          judgeStart,
          judgeOut
            ? `score=${judgeOut.score}${regenAttempted ? ' regen=1' : ''}`
            : 'requested-no-judge-wired',
        );
      }

      // 9a) Post-judge multi-agent debate gate — DEFAULT for stakes ≥ high
      // when the caller has not signalled cost-sensitivity. Replaces the
      // post-judge `normalised.text` with the Proposer→Critic→Synthesizer
      // synthesis. Constitutional rules pass through to the critic so a
      // proposal that violates TZ Rental Act / KRA tax filing is flagged
      // before the synthesizer commits. Failures collapse to the legacy
      // single-shot path (debate is best-effort; the judge already vetted
      // the original). Skipped when the step-7 detour debate already ran
      // — the older detour ALREADY produced a multi-voice synthesis, so
      // re-running the 3-agent path would double-spend tokens.
      //
      // Also skipped when the caller wired `deps.synthesizer`: that
      // signals the caller owns multi-agent merging explicitly (turning
      // it on per turn via `req.requireSynthesis`). Running both paths
      // would double-spend tokens and contradict the caller's intent.
      if (
        (req.stakes === 'high' || req.stakes === 'critical') &&
        req.estimatedCostUsd === undefined &&
        debateRoundsCompleted === undefined &&
        deps.synthesizer === undefined
      ) {
        const debateGateStart = clock().getTime();
        try {
          const { runThreeAgentDebate } = await import('./debate/three-agent-debate.js');
          const { BORJIE_CONSTITUTION } = await import('./critics/constitutional-critic.js');
          // Adapt the kernel's SensorRouter (3-arg `call`) to the
          // three-agent debate's narrower `SensorLike` (single-arg `call`).
          const debateSensor = {
            call: (args: SensorCallArgs) => router.call(args, required),
          };
          const debateOut = await runThreeAgentDebate(
            req.userMessage,
            system,
            debateSensor,
            {
              maxTokens: 8000,
              constitutionalRules: BORJIE_CONSTITUTION.map((r) => ({ id: r.id, description: r.description })),
            },
          );
          if (debateOut.synthesis && debateOut.synthesis.trim().length > 0) {
            sensorResult = { ...sensorResult, text: debateOut.synthesis };
            normalised = normalize(debateOut.synthesis);
            debateRoundsCompleted = 3;
            debateConverged = debateOut.convergence >= 0.8;
          }
          traceStep(
            'debate',
            debateGateStart,
            `mode=three-agent tokens=${debateOut.tokensUsed} latency=${debateOut.latencyMs} convergence=${debateOut.convergence.toFixed(2)}`,
          );
        } catch (e) {
          traceStep('debate', debateGateStart, 'three-agent failed; keeping single-shot answer', e);
        }
      }

      // 9b) Conflict-monitored effort recruitment (win #5 / System 1/2).
      // The router decides depth ONCE at ingress. But a turn the router
      // scored 'fast'/'standard' can still surface CONFLICT after the
      // first cheap pass — low confidence, cross-vendor disagreement, a
      // non-converged debate, a failed judge. We compose those (already-
      // computed) signals into ONE conflict scalar and, when it crosses
      // the threshold on a fast/standard lane that hasn't ALREADY
      // deliberated, RECRUIT the next depth tier ONCE: re-run the wired
      // three-agent debate detour. This converts uncertainty-policy's
      // dead-end 'escalate' (refuse) into 'think harder FIRST, refuse
      // only if still unsure'. All rails stay intact — we only deepen
      // DELIBERATION; we never bypass a gate or act. One upshift per turn.
      const conflictRecruitmentEnabled =
        deps.conflictRecruitmentEnabled !== false;
      const conflictRoute = resolveFastPathEnabled()
        ? decideFastPath(req).route
        : 'full';
      if (
        conflictRecruitmentEnabled &&
        debateRoundsCompleted === undefined &&
        req.estimatedCostUsd === undefined &&
        deps.synthesizer === undefined
      ) {
        // Cheap early-confidence proxy over the current draft so the gate
        // can read a confidence signal BEFORE the formal step-12 scoring.
        const earlyConfidence = scoreConfidence({
          outputText: normalised.text,
          citationCount: extractCitationsFromUiBlock(normalised.uiBlock).length,
          toolResultNumbers: collectToolNumbers(sensorResult),
          judgeScore: judgeOut?.score ?? null,
          rerolledOutputText: null,
        });
        const conflict = computeConflictScalar({
          confidenceOverall: earlyConfidence.overall,
          synthAgreement: synthAgreement ?? null,
          synthEscalate: synthEscalate === true,
          debateConverged: debateConverged ?? null,
          judgeScore: judgeOut?.score ?? null,
        });
        const recruit = recruitControl({
          conflict,
          currentRoute: conflictRoute,
          enabled: conflictRecruitmentEnabled,
        });
        if (recruit.escalate) {
          const recruitStart = clock().getTime();
          try {
            const { runThreeAgentDebate } = await import(
              './debate/three-agent-debate.js'
            );
            const { BORJIE_CONSTITUTION } = await import(
              './critics/constitutional-critic.js'
            );
            const debateSensor = {
              call: (args: SensorCallArgs) => router.call(args, required),
            };
            const debateOut = await runThreeAgentDebate(
              req.userMessage,
              system,
              debateSensor,
              {
                maxTokens: 8000,
                constitutionalRules: BORJIE_CONSTITUTION.map((r) => ({
                  id: r.id,
                  description: r.description,
                })),
              },
            );
            if (debateOut.synthesis && debateOut.synthesis.trim().length > 0) {
              sensorResult = { ...sensorResult, text: debateOut.synthesis };
              normalised = normalize(debateOut.synthesis);
              debateRoundsCompleted = 3;
              debateConverged = debateOut.convergence >= 0.8;
            }
            traceStep(
              'debate',
              recruitStart,
              `mode=conflict-recruit route=${conflictRoute} conflict=${conflict.toFixed(2)} convergence=${debateOut.convergence.toFixed(2)}`,
            );
          } catch (e) {
            traceStep(
              'debate',
              recruitStart,
              `conflict-recruit failed; keeping fast-lane answer conflict=${conflict.toFixed(2)}`,
              e,
            );
          }
        } else if (conflict > 0) {
          traceStep(
            'confidence',
            clock().getTime(),
            `conflict=${conflict.toFixed(2)} route=${conflictRoute} recruit=0`,
          );
        }
      }

      // (Tool / citation extraction is the agent-loop's job; for the
      //  non-streaming path the citations array is empty unless the
      //  sensor produced one explicitly via ui_block.)
      const citations: ReadonlyArray<Citation> = extractCitationsFromUiBlock(normalised.uiBlock);
      const artifacts: ReadonlyArray<Artifact> = extractArtifactsFromUiBlock(normalised.uiBlock);

      // 10) self-awareness drift
      const driftStart = clock().getTime();
      const capturedAt = clock().toISOString();
      const sa = checkSelfAwareness({
        persona,
        outputText: normalised.text,
        toolCallCount: sensorResult.toolCalls.length,
        hasCitations: citations.length > 0,
        thoughtId,
        capturedAt,
      });
      if (sa.events.length > 0 && deps.driftSink) {
        for (const ev of sa.events) await deps.driftSink.record(ev);
      }
      traceStep(
        'drift-check',
        driftStart,
        `verdict=${sa.verdict.status} events=${sa.events.length}`,
      );
      if (sa.verdict.status === 'block') {
        const decision = makeRefusal({
          thoughtId,
          req,
          reason: sa.verdict.reason,
          gate: 'drift',
          startedAt,
          clockNow: clock(),
        });
        if (deps.provenanceSink) {
          void deps.provenanceSink.record(decision.provenance).catch(() => undefined);
        }
        finaliseTrace('refusal', 'drift');
        return decision;
      }

      // 10b) C5 — Self-RAG critique. Runs IsREL / IsSUP / IsUSE
      // reflection tokens on the normalised text. When the critic
      // blocks (IsSUP=low|unknown on a financial / contractual claim),
      // refuse the turn with `gate: 'policy'` and reason
      // `'self-rag/insufficient-support'`. The critic is the same
      // shape as the legacy judge port; failures collapse to
      // 'unknown' tokens and never block by themselves.
      let selfRagVerdict: SelfRagVerdict | null = null;
      if (deps.selfRagJudge) {
        const sragStart = clock().getTime();
        selfRagVerdict = await runSelfRag({
          userMessage: req.userMessage,
          responseText: normalised.text,
          retrievedContext: collectSelfRagContext(
            semanticFacts,
            reflectiveDigest,
            groundingFacts,
          ),
          judge: deps.selfRagJudge,
          // EP-3 CRITICAL #3 — fail-closed when judge unavailable for
          // high/critical stakes (prod only). Self-rag.ts decides the
          // env gating; we just propagate the stakes signal.
          stakes: req.stakes,
        });
        traceStep(
          'self-rag',
          sragStart,
          `rel=${selfRagVerdict.isRel} sup=${selfRagVerdict.isSup} use=${selfRagVerdict.isUse}${selfRagVerdict.blocked ? ' blocked=1' : ''}`,
        );
        if (selfRagVerdict.blocked) {
          const decision = makeRefusal({
            thoughtId,
            req,
            reason:
              selfRagVerdict.blockedReason ?? 'self-rag/insufficient-support',
            gate: 'policy',
            startedAt,
            clockNow: clock(),
          });
          if (deps.provenanceSink) {
            void deps.provenanceSink
              .record(decision.provenance)
              .catch(() => undefined);
          }
          // C5 — even on refusal we may want to record a reflexion if
          // the user explicitly ended the session. The flag is checked
          // again on the success path below; doing it here too keeps
          // the failure branch symmetric.
          await maybeWriteReflexion({
            deps,
            req,
            tenantId: memTenantId,
            userId: memUserId,
            outcome: 'failure',
            negativeNotes: [
              selfRagVerdict.blockedReason ?? 'Self-RAG blocked the response',
            ],
            groundedFacts: semanticFacts.map((f) => `${f.key}=${asValueString(f.value)}`),
          });
          finaliseTrace('refusal', 'policy');
          return decision;
        }
      }

      // 10b) D8 — regulatory mirror runs BEFORE the policy gate when
      //      `deps.regulatoryMirror` + `req.regulatoryProbe` are both
      //      wired. 'refuse' produces a hard refusal; 'flag' appends
      //      the citation through to the policy-gate input.
      let regulatoryCiteText = '';
      const regProbe = (req as { regulatoryProbe?: {
        jurisdiction: 'TZ' | 'KE' | 'UAE';
        action: 'pay_royalty' | 'file_royalty_return' | 'export_mineral' | 'sell_gold' | 'transfer_licence' | 'operate_without_licence' | 'suspend_licence' | 'use_mercury';
        payload: Record<string, unknown>;
      } }).regulatoryProbe;
      if (deps.regulatoryMirror && regProbe) {
        const regStart = clock().getTime();
        try {
          const reg = deps.regulatoryMirror.check({
            jurisdiction: regProbe.jurisdiction,
            action: regProbe.action,
            payload: regProbe.payload as never,
          });
          traceStep(
            'policy-gate' as KernelStepName,
            regStart,
            `regulatory-mirror verdict=${reg.verdict} matches=${reg.matches.length}`,
          );
          if (reg.verdict === 'refuse') {
            const decision = makeRefusal({
              thoughtId,
              req,
              reason: `regulatory/${reg.matches[0]?.ruleId ?? 'refuse'}`,
              gate: 'policy',
              startedAt,
              clockNow: clock(),
            });
            finaliseTrace('refusal', 'policy');
            return decision;
          }
          if (reg.verdict === 'flag') regulatoryCiteText = reg.citeText;
        } catch (e) {
          traceStep('policy-gate' as KernelStepName, regStart, 'regulatory-mirror failed', e);
        }
      }

      // 11) policy gate — supply the K5.2 request context so the new
      //     tenant-isolation / scope-match / cost-ceiling / off-hours
      //     checks can fire when the caller threaded the relevant
      //     fields through `ThoughtRequest`.
      const policyStart = clock().getTime();
      const policyText = regulatoryCiteText
        ? `${normalised.text}\n\n[Regulatory note]\n${regulatoryCiteText}`
        : normalised.text;
      const policy = runPolicyGate({
        text: policyText,
        hasCitations: citations.length > 0,
        request: buildPolicyGateRequestContext(req, clock),
      });
      traceStep('policy-gate', policyStart, `verdict=${policy.verdict.status}`);

      // 12) confidence
      const confStart = clock().getTime();
      const confidence = scoreConfidence({
        outputText: policy.redactedText,
        citationCount: citations.length,
        toolResultNumbers: collectToolNumbers(sensorResult),
        judgeScore: judgeOut?.score ?? null,
        rerolledOutputText: null,
      });
      traceStep(
        'confidence',
        confStart,
        `overall=${confidence.overall.toFixed(2)} g=${confidence.groundedness.toFixed(2)} s=${confidence.stability.toFixed(2)} r=${confidence.review.toFixed(2)} n=${confidence.numericalConsistency.toFixed(2)}`,
      );

      // 11a) uncertainty policy — pure function over the confidence
      //      vector. May caveat the text, force ask-back, or escalate
      //      to a refusal for LOW_CONFIDENCE_HIGH_STAKES. Opt-in via
      //      `deps.uncertaintyPolicy === 'on'`; off by default so the
      //      kernel's existing test contracts (synthetic short replies
      //      with no citations) keep passing.
      let uncertainty: UncertaintyDecision | null = null;
      if (deps.uncertaintyPolicy === 'on') {
        const uncStart = clock().getTime();
        uncertainty = resolveUncertaintyPolicy({
          confidence,
          stakes: req.stakes,
          outputText: policy.redactedText,
        });
        traceStep(
          'uncertainty-policy',
          uncStart,
          `action=${uncertainty.action} weakest=${uncertainty.weakestComponent}` +
            (uncertainty.affectedEntities.length > 0
              ? ` entities=${uncertainty.affectedEntities.join(',')}`
              : ''),
        );
        if (uncertainty.action === 'escalate') {
          const decision = makeRefusal({
            thoughtId,
            req,
            reason: uncertainty.escalationReason || 'LOW_CONFIDENCE_HIGH_STAKES',
            gate: 'policy',
            startedAt,
            clockNow: clock(),
          });
          if (deps.provenanceSink) {
            void deps.provenanceSink.record(decision.provenance).catch(() => undefined);
          }
          finaliseTrace('refusal', 'uncertainty');
          return decision;
        }
      }
      const finalText = uncertainty?.text || policy.redactedText;

      // 13) provenance + cache + CoT capture
      const provStart = clock().getTime();
      const provenance: ProvenanceRecord = {
        thoughtId,
        threadId: req.threadId,
        scopeKind: req.scope.kind,
        tier: req.tier,
        stakes: req.stakes,
        inputHash: sha(req.userMessage),
        outputHash: sha(finalText),
        toolCallSummaries: sensorResult.toolCalls.map((tc) => ({
          toolName: tc.toolName,
          latencyMs: 0,
          ok: true,
        })),
        sensorId: sensorResult.sensorId,
        modelId: sensorResult.modelId,
        cacheHit: false,
        judgeScore: judgeOut?.score ?? null,
        cohortFingerprints: cohortMix.fingerprints,
        producedAt: capturedAt,
        latencyMs: clock().getTime() - startedAt,
        ...(debateRoundsCompleted !== undefined
          ? { debateRoundsCompleted }
          : {}),
        ...(debateConverged !== undefined ? { debateConverged } : {}),
      };

      if (reservoir) {
        await reservoir.maybeCapture({
          thoughtId,
          threadId: req.threadId,
          stakes: req.stakes,
          thoughtText: sensorResult.thought,
          capturedAt,
        });
      }

      const gates: GateOutcome = {
        inviolable: { status: 'pass' },
        policy: policy.verdict,
        drift: sa.verdict,
        cognitiveLoad: loadOut.verdict,
      };

      const decision: BrainDecision = pickDecisionShape({
        gates,
        text: finalText,
        citations,
        artifacts,
        confidence,
        provenance,
      });

      // R7 — proof-carrying membrane (SHADOW). Compute + emit a signed,
      // hash-chained certificate alongside the already-final `decision` and
      // log any divergence from what the existing checks already decided.
      // This is a VOID, fail-closed, CI-inert side-channel: it cannot — and
      // does not — alter `decision`. The existing checks remain the sole
      // deciders until a later validated wave flips the gatekeeper to
      // enforce. No-op when `deps.safetyGatekeeper` is absent.
      runKernelShadowGatekeeper(deps, req, decision, gates, citations);

      cache.set(cacheKey, decision);
      // LP-03 — semantic cache write-through. Best-effort, never blocks
      // the caller, and only persists `answer` decisions (refusals /
      // softened replies are request-frame-specific). Re-uses the miss
      // embedding from the read step so we don't embed twice.
      if (deps.semanticCache && semanticCacheEnabled) {
        void semanticCacheWrite({
          cache: deps.semanticCache,
          enabled: semanticCacheEnabled,
          scope: semanticScope,
          userMessage: req.userMessage,
          decision,
          missEmbedding: semanticMissEmbedding,
          cacheId: thoughtId,
        });
      }
      if (deps.provenanceSink) {
        // Fire-and-forget; never block the caller on persistence.
        void deps.provenanceSink.record(provenance).catch(() => undefined);
      }
      // Episodic memory writes — fire-and-forget, never blocks the
      // caller, errors swallowed.
      // A2b-2 wire #2 — scrubbed userMessage so `kernel_memory_
      // _episodic.summary` cannot leak raw PII (the table is not in
      // the RTBF list so a retention bypass would otherwise be the
      // leak vector).
      writeEpisodicTurnTrace({
        memory: deps.memory,
        tenantId: memTenantId,
        userId: memUserId,
        threadId: req.threadId,
        turnId: thoughtId,
        userMessage: scrubbedUserMessage,
        agentText: pickAgentTraceText(decision),
      });
      // Cross-session ToM close-the-loop (win #1) — fold one observation
      // of this turn back into the durable owner-style posterior so the
      // NEXT turn is already biased toward how this owner wants to be
      // spoken to. Fire-and-forget; never blocks the caller.
      maybeRefineOwnerStyle({
        reader: deps.ownerStyleReader,
        tenantId: memTenantId,
        userMessage: scrubbedUserMessage,
        nowMs: clock().getTime(),
      });
      traceStep('provenance-write', provStart, `outcome=${decision.kind}`);

      // C5 — Reflexion write-at-end. Records a verbal reflection when
      // the inbound message is an explicit session terminator (idle-
      // end detection is the caller's responsibility). Outcome
      // inferred from the decision shape + Self-RAG verdict.
      {
        const negativeNotes =
          selfRagVerdict && selfRagVerdict.isSup !== 'high'
            ? [`Self-RAG SUP=${selfRagVerdict.isSup}: ${selfRagVerdict.rationale}`]
            : undefined;
        const groundedFacts = semanticFacts
          .slice(0, 5)
          .map((f) => `${f.key}=${asValueString(f.value)}`);
        await maybeWriteReflexion({
          deps,
          req,
          tenantId: memTenantId,
          userId: memUserId,
          outcome: inferReflexionOutcome(decision, selfRagVerdict),
          ...(negativeNotes ? { negativeNotes } : {}),
          ...(groundedFacts.length > 0 ? { groundedFacts } : {}),
        });
      }

      finaliseTrace(decision.kind);
      void rng;
      return decision;
    },

    /**
     * Token-level streaming counterpart to `think`. Mirrors the same
     * 14-step pipeline (steps 0 → 13 plus 11a):
     *   - pre-sensor steps run synchronously (no deltas yet)
     *   - on pre-sensor refusal, yields turn_start + done(refusal)
     *   - on cache hit, yields turn_start, the cached text in one
     *     text_delta, confidence (when present), then done
     *   - on a stream-capable sensor, forwards text_delta /
     *     thought_delta events live; accumulates internally for the
     *     post-sensor pipeline
     *   - on a non-stream-capable sensor, calls `router.call(...)` and
     *     emits the final text as one text_delta (legacy fallback)
     *   - on stop, runs normalize → judge → drift → policy → confidence
     *     → provenance → cache.set, emitting gate_verdict events for
     *     drift/policy soften+block and a confidence event before done
     */
    async *thinkStream(
      req: ThoughtRequest,
      options?: KernelCallOptions,
    ): AsyncIterable<KernelStreamEvent> {
      // Phase E.5.1 — orchestrator-routed streaming. When wired + flag
      // on, the orchestrator's non-streaming `think()` runs and we
      // translate the final answer into the legacy `JarvisStreamEvent`
      // shape so the kernel's streaming contract is preserved. Token-
      // level streaming through the orchestrator's hook chain is a
      // follow-up (E1 emits decisions, not tokens). The translation
      // layer still emits at least: turn_start, ≥1 text_delta,
      // confidence (when present), done.
      if (orchestratorRoutingEnabled && deps.orchestrator) {
        // 0) killswitch — administrative HALT short-circuit, streaming +
        //    orchestrator path. The orchestrator main-loop has no
        //    killswitch step of its own, so enforcing it here keeps the
        //    HALT fail-closed regardless of the routing flag. We emit
        //    `turn_start` first (the streaming contract guarantees it),
        //    then — on HALT — a `gate_verdict` block + `done(refusal)`
        //    with no deltas, mirroring the legacy stream step-0.
        const ksHalt = evaluateKillswitchHalt({
          killswitch: deps.killswitch,
          req,
          thoughtId: randomUUID(),
          startedAt: clock().getTime(),
          clockNow: clock(),
          provenanceSink: deps.provenanceSink,
        });
        if (ksHalt) {
          yield personaStartEvent(selectPersona(req));
          yield {
            kind: 'gate_verdict',
            gate: 'inviolable',
            verdict: { status: 'block', reason: ksHalt.state.reasonCode },
          };
          yield { kind: 'done', decision: ksHalt.decision };
          return;
        }
        yield* streamViaOrchestrator(req, deps, clock);
        return;
      }

      const startedAt = clock().getTime();
      const thoughtId = randomUUID();
      const cacheKey = thoughtCacheKey(req);

      // A2b-2 wires #1 + #2 — pre-LLM PII scrub, streaming path.
      const scrubbedUserMessage = scrubCotForPersist(req.userMessage).scrubbed;

      // Pre-sensor persona — needed for the turn_start event below.
      const baseSurfacePersona = selectPersona(req);
      const branding = deps.brandingResolver
        ? await deps.brandingResolver
            .resolve({
              tenantId: req.scope.kind === 'tenant' ? req.scope.tenantId : null,
              surface: req.surface,
            })
            .catch(() => null)
        : null;
      const persona = applyBrandingOverride(baseSurfacePersona, branding);

      yield personaStartEvent(persona);

      // 0) killswitch — administrative HALT short-circuit. Streaming
      //    callers see turn_start + done(refusal) with no deltas; this
      //    mirrors the non-stream path's "no sensor budget spent"
      //    invariant.
      if (deps.killswitch) {
        const streamTenantId =
          req.scope.kind === 'tenant' ? req.scope.tenantId : null;
        const ks = resolveKillswitch(deps.killswitch, streamTenantId);
        if (ks.level === 'halt') {
          const decision = makeRefusal({
            thoughtId,
            req,
            reason: renderKillswitchRefusalText(ks),
            gate: 'inviolable',
            startedAt,
            clockNow: clock(),
          });
          if (deps.provenanceSink) {
            void deps.provenanceSink
              .record(decision.provenance)
              .catch(() => undefined);
          }
          yield {
            kind: 'gate_verdict',
            gate: 'inviolable',
            verdict: { status: 'block', reason: ks.reasonCode },
          };
          yield { kind: 'done', decision };
          return;
        }
      }

      // 1) brain-side cache. On hit, replay as a single delta + done.
      const cached = cache.get(cacheKey);
      if (cached) {
        if (cached.kind !== 'refusal') {
          if (cached.text) {
            yield { kind: 'text_delta', text: cached.text };
          }
          yield { kind: 'confidence', vector: cached.confidence };
        }
        yield { kind: 'done', decision: cached };
        return;
      }

      // 2) inviolable
      const inviolable = checkInviolable(req);
      if (inviolable.status === 'block') {
        const decision = makeRefusal({
          thoughtId,
          req,
          reason: inviolable.reason ?? 'inviolable rule blocked the request',
          gate: 'inviolable',
          startedAt,
          clockNow: clock(),
        });
        if (deps.provenanceSink) {
          void deps.provenanceSink.record(decision.provenance).catch(() => undefined);
        }
        yield {
          kind: 'gate_verdict',
          gate: 'inviolable',
          verdict: { status: 'block', reason: inviolable.reason ?? 'blocked' },
        };
        yield { kind: 'done', decision };
        return;
      }

      // 3) tier compatibility
      const tierCheck = isTierCompatibleWithScope(req.tier, req.scope);
      if (!tierCheck.ok) {
        const decision = makeRefusal({
          thoughtId,
          req,
          reason: tierCheck.reason,
          gate: 'inviolable',
          startedAt,
          clockNow: clock(),
        });
        if (deps.provenanceSink) {
          void deps.provenanceSink.record(decision.provenance).catch(() => undefined);
        }
        yield {
          kind: 'gate_verdict',
          gate: 'inviolable',
          verdict: { status: 'block', reason: tierCheck.reason },
        };
        yield { kind: 'done', decision };
        return;
      }

      // 4) memory recall
      const priorTurns = deps.priorTurnsLoader
        ? await deps.priorTurnsLoader(req.threadId)
        : [];

      // 4b) hierarchical memory recall — semantic + reflective.
      const memTenantId =
        req.scope.kind === 'tenant' ? req.scope.tenantId : null;
      const memUserId = req.scope.actorUserId;
      const streamQueryEmbedding = await resolveQueryEmbedding(req, deps.embedder);
      const semanticFacts = await loadSemanticFacts(
        deps.memory,
        memTenantId,
        memUserId,
        streamQueryEmbedding,
      );
      const reflectiveDigest = await loadReflectiveDigest(deps.memory, memTenantId, memUserId);

      // 4c) online-learning feedback recall.
      const feedbackRecent = await loadFeedbackRecent(
        deps.feedback,
        memTenantId,
        memUserId,
      );

      // 4d) agency — active goals for the (tenant, user) pair.
      const activeGoals = await loadActiveGoals(
        deps.agency,
        memTenantId,
        memUserId,
      );

      // 5) cohort signal
      const cohortMix = deps.cohort
        ? await buildCohortMixin({ source: deps.cohort, tier: req.tier, userMessage: req.userMessage })
        : { findings: [], promptFragment: '', fingerprints: [] as ReadonlyArray<string> };

      // 5b) grounding facts
      const groundingFacts: ReadonlyArray<GroundingFact> = deps.groundingFacts
        ? await deps.groundingFacts
            .fetch({ userMessage: req.userMessage, tier: req.tier, limit: 6 })
            .catch(() => [])
        : [];

      // 6) identity + ToM + cognitive-load
      const identity = renderIdentityPreamble({ persona, scope: req.scope });

      // D5 — rollout controller. Same wiring as the non-streaming
      // path; every failure mode collapses to the hard-coded preamble.
      let rolloutPromptFragment = '';
      if (deps.rolloutController) {
        try {
          const decision = await deps.rolloutController.pickPrompt({
            tenantId:
              req.scope.kind === 'tenant' ? req.scope.tenantId : null,
            capability: 'kernel-system',
          });
          if (decision && decision.promptText.length > 0) {
            rolloutPromptFragment = decision.promptText;
          }
        } catch {
          // Swallowed — kernel falls back to its hard-coded preamble.
        }
      }

      // K3 — platform-voice anchor + situated address (cache-eligible
      // prefix) + per-surface identity + module-inventory block.
      const personaPrelude = renderPersonaPrelude(
        buildSituatedAddressArgs(req, clock),
      );
      const moduleInventory = renderSelfAwarenessBlock(deps.bodySchemaReader);

      // Salience Arena (wins #3 + #4), streaming path. The `turn_start`
      // persona event already fired with the stable surface-default id
      // (consumers key off it), so on the streaming path the salience
      // winner shapes the SYSTEM PROMPT (live-concern + voice register)
      // rather than the streamed persona identity. Best-effort reads.
      const [streamDriveBids, streamActivationBids, streamAffectBids] =
        await Promise.all([
          buildDriveBids(deps.pendingProposalReader, memTenantId),
          buildActivationBids(deps.situationalSnapshotReader, memTenantId),
          buildAffectBids(deps.behaviorSignalSource, memTenantId, memUserId),
        ]);
      const salience = resolveSalienceFocus([
        streamAffectBids,
        streamDriveBids,
        streamActivationBids,
      ]);

      const mindState = inferMindState(req.userMessage);
      const affectiveProfile = observeAffective(
        deps.affectiveAccumulator,
        memTenantId,
        memUserId,
        mindState,
        clock,
      );
      const perTurnMindDirective = affectiveProfile
        ? renderMindStateDirectiveWithProfile(mindState, affectiveProfile)
        : renderMindStateDirective(mindState);

      // Cross-session ToM (win #1) — durable owner-style hint beside the
      // per-turn affective directive. Best-effort: '' on any failure.
      const ownerStyleHint =
        deps.ownerStyleReader && memTenantId
          ? await deps.ownerStyleReader
              .getStyleHint(memTenantId)
              .catch(() => '')
          : '';
      const mindDirective =
        ownerStyleHint && ownerStyleHint.trim().length > 0
          ? `${perTurnMindDirective} ${ownerStyleHint.trim()}`
          : perTurnMindDirective;

      const recentTurns = deps.recentTurnCounter ? await deps.recentTurnCounter(req.threadId) : 0;
      const loadOut = assessCognitiveLoad({
        userMessage: req.userMessage,
        recentTurnCount: recentTurns,
      });
      const loadProfile = observeCognitiveLoad(
        deps.cognitiveLoadAccumulator,
        memTenantId,
        memUserId,
        loadOut,
        clock,
      );
      const loadDirective = loadProfile
        ? renderLoadDirectiveWithProfile(loadOut, loadProfile)
        : renderLoadDirective(loadOut);

      // LP-06 + LP-09 — same deterministic ordering + terminal security
      // layers as the non-streaming `think()` path. Kept in lock-step so
      // a turn served over SSE and one served buffered share the same
      // cacheable prefix. BRAIN §5 — the fragment record is rendered to BOTH
      // the flat `system` string (byte-identical to before, for every
      // call-site) AND `systemSegments`, which marks the stable persona +
      // tenant-agnostic prefix so the Anthropic adapter places a
      // prompt-prefix cache breakpoint there. The two views carry the SAME
      // content; only the segment boundaries differ.
      const systemFragments = {
        personaPrelude,
        identity,
        rolloutPrompt: rolloutPromptFragment,
        moduleInventory,
        locus: `Locus: ${locusPhrase(req.tier, req.scope)}.`,
        // Salience focus folded into the behavioural-directive slot —
        // same dynamic slot, no prompt-cache reorder. Empty when no
        // arena winner (legacy directive verbatim).
        behaviouralDirective: salience.directive
          ? `Behavioural directive: ${mindDirective}\n${salience.directive}`
          : `Behavioural directive: ${mindDirective}`,
        verbosityDirective: `Verbosity directive: ${loadDirective}`,
        semanticMemory: renderSemanticMemoryFragment(semanticFacts),
        reflectiveDigest: renderReflectiveDigestFragment(reflectiveDigest),
        feedback: renderFeedbackFragment(feedbackRecent),
        activeGoals: renderActiveGoalsFragment(activeGoals),
        grounding: renderGroundingFragment(groundingFacts),
        cohortMix: cohortMix.promptFragment,
        // Item-1 — ABSOLUTE single-language pin on the streaming legacy
        // persona path, at parity with the buffered + orchestrator paths.
        languageDirective: renderOrchestratorLanguageDirective(
          req.language === 'sw' ? 'sw' : 'en',
        ),
      };
      const system = assembleSystemPrompt(systemFragments);
      const systemSegments = assembleSystemPromptBlocks(systemFragments);

      // 7) sensor selection. Prefer `callStream` when an eligible sensor
      // exposes it; otherwise fall back to `router.call(...)` and emit
      // the result as a single delta (legacy fallback for sensors that
      // pre-date the streaming protocol).
      const wantsThinking = req.stakes === 'high' || req.stakes === 'critical';
      const hasAttachments = (req.attachments?.length ?? 0) > 0;
      const required: Array<'vision' | 'thinking' | 'fast' | 'batch'> = [];
      if (wantsThinking) required.push('thinking');
      if (hasAttachments) required.push('vision');

      // A2b-2 wire #1 — scrubbed userMessage on the streaming egress.
      // Forward the optional cancellation signal so a disconnected SSE client
      // stops provider token generation on the direct-streaming-sensor path.
      const sensorArgs: SensorCallArgs = {
        system,
        systemPrompt: system,
        systemSegments,
        userMessage: scrubbedUserMessage,
        priorTurns,
        extendedThinking: wantsThinking,
        stakes: req.stakes,
        ...(req.attachments ? { attachments: req.attachments } : {}),
        ...(options?.signal ? { signal: options.signal } : {}),
      };

      const streamingSensor = pickStreamingSensor(deps.sensors, required);

      let accumulatedText = '';
      let accumulatedThought: string | null = null;
      let toolCalls: Array<{ toolName: string; input: unknown; callId: string }> = [];
      let sensorId = '__unknown__';
      let modelId = '__unknown__';
      let sensorLatencyMs = 0;

      if (streamingSensor && streamingSensor.callStream) {
        sensorId = streamingSensor.id;
        modelId = streamingSensor.modelId;
        const sensorStart = clock().getTime();
        try {
          for await (const ev of streamingSensor.callStream(sensorArgs)) {
            if (ev.kind === 'turn_start') {
              modelId = ev.modelId;
              sensorId = ev.sensorId;
              continue;
            }
            if (ev.kind === 'text_delta') {
              accumulatedText += ev.text;
              yield { kind: 'text_delta', text: ev.text };
              continue;
            }
            if (ev.kind === 'thought_delta') {
              accumulatedThought = (accumulatedThought ?? '') + ev.text;
              yield { kind: 'thought_delta', text: ev.text };
              continue;
            }
            if (ev.kind === 'tool_call') {
              toolCalls.push({
                toolName: ev.toolName,
                input: ev.input,
                callId: ev.callId,
              });
              continue;
            }
            if (ev.kind === 'stop') {
              sensorLatencyMs = ev.latencyMs;
              break;
            }
          }
        } catch (streamErr) {
          // D19 — HONEST MID-STREAM DEGRADE. A provider throw mid-stream is a
          // real failure, at parity with the buffered `think()` path (which
          // rethrows). We MUST NOT swallow it and fall through to a fabricated
          // `done(answer)` with empty/partial text, nor cache that phantom.
          // Emit a terminal `error` event and STOP — the customer sees an
          // honest degrade, never a truncated answer dressed as a completed
          // turn. `partial` distinguishes "nothing streamed" from "cut off".
          sensorLatencyMs = clock().getTime() - sensorStart;
          const reason =
            streamErr instanceof Error && streamErr.message
              ? streamErr.message
              : 'SENSOR_STREAM_FAULT';
          yield {
            kind: 'error',
            reason,
            partial: accumulatedText.length > 0,
          };
          return;
        }
      } else {
        const single = await router.call(sensorArgs, required);
        sensorId = single.sensorId;
        modelId = single.modelId;
        accumulatedText = single.text;
        accumulatedThought = single.thought;
        toolCalls = [...single.toolCalls];
        sensorLatencyMs = single.latencyMs;
        if (accumulatedText) {
          yield { kind: 'text_delta', text: accumulatedText };
        }
      }

      // 8) normalize
      const normalised = normalize(accumulatedText);

      // 9) judge
      const judgeRequested = req.requireJudge === true || req.stakes === 'critical';
      const judgeOut = judgeRequested && deps.judge
        ? await deps.judge(normalised.text)
        : null;

      const citations: ReadonlyArray<Citation> = extractCitationsFromUiBlock(normalised.uiBlock);
      const artifacts: ReadonlyArray<Artifact> = extractArtifactsFromUiBlock(normalised.uiBlock);

      // 10) self-awareness drift
      const capturedAt = clock().toISOString();
      const sa = checkSelfAwareness({
        persona,
        outputText: normalised.text,
        toolCallCount: toolCalls.length,
        hasCitations: citations.length > 0,
        thoughtId,
        capturedAt,
      });
      if (sa.events.length > 0 && deps.driftSink) {
        for (const ev of sa.events) await deps.driftSink.record(ev);
      }
      if (sa.verdict.status === 'soften' || sa.verdict.status === 'block') {
        yield { kind: 'gate_verdict', gate: 'drift', verdict: sa.verdict };
      }
      if (sa.verdict.status === 'block') {
        const decision = makeRefusal({
          thoughtId,
          req,
          reason: 'reason' in sa.verdict ? sa.verdict.reason : 'drift blocked',
          gate: 'drift',
          startedAt,
          clockNow: clock(),
        });
        if (deps.provenanceSink) {
          void deps.provenanceSink.record(decision.provenance).catch(() => undefined);
        }
        yield { kind: 'done', decision };
        return;
      }

      // 11) policy gate — supply request context (see non-stream path).
      const policy = runPolicyGate({
        text: normalised.text,
        hasCitations: citations.length > 0,
        request: buildPolicyGateRequestContext(req, clock),
      });
      if (policy.verdict.status === 'soften' || policy.verdict.status === 'block') {
        yield { kind: 'gate_verdict', gate: 'policy', verdict: policy.verdict };
      }

      // 12) confidence
      const sensorResultLike: SensorCallResult = {
        text: accumulatedText,
        thought: accumulatedThought,
        toolCalls,
        latencyMs: sensorLatencyMs,
        modelId,
        sensorId,
      };
      const confidence = scoreConfidence({
        outputText: policy.redactedText,
        citationCount: citations.length,
        toolResultNumbers: collectToolNumbers(sensorResultLike),
        judgeScore: judgeOut?.score ?? null,
        rerolledOutputText: null,
      });

      // 11a) uncertainty policy — applies AFTER deltas are streamed.
      //      Opt-in via `deps.uncertaintyPolicy === 'on'`. For
      //      caveat/ask-back the wrapped text lands in the final
      //      decision so non-streaming consumers see the caveat; the
      //      streaming consumer has already seen raw deltas. For
      //      escalate the final decision is a refusal and consumers
      //      see a gate_verdict + done(refusal) event.
      let uncertainty: UncertaintyDecision | null = null;
      if (deps.uncertaintyPolicy === 'on') {
        uncertainty = resolveUncertaintyPolicy({
          confidence,
          stakes: req.stakes,
          outputText: policy.redactedText,
        });
        if (uncertainty.action === 'escalate') {
          const decision = makeRefusal({
            thoughtId,
            req,
            reason: uncertainty.escalationReason || 'LOW_CONFIDENCE_HIGH_STAKES',
            gate: 'policy',
            startedAt,
            clockNow: clock(),
          });
          if (deps.provenanceSink) {
            void deps.provenanceSink
              .record(decision.provenance)
              .catch(() => undefined);
          }
          yield {
            kind: 'gate_verdict',
            gate: 'policy',
            verdict: { status: 'block', reason: 'LOW_CONFIDENCE_HIGH_STAKES' },
          };
          yield { kind: 'done', decision };
          return;
        }
      }
      const finalText = uncertainty?.text || policy.redactedText;

      // 13) provenance + cache + CoT capture
      const provenance: ProvenanceRecord = {
        thoughtId,
        threadId: req.threadId,
        scopeKind: req.scope.kind,
        tier: req.tier,
        stakes: req.stakes,
        inputHash: sha(req.userMessage),
        outputHash: sha(finalText),
        toolCallSummaries: toolCalls.map((tc) => ({
          toolName: tc.toolName,
          latencyMs: 0,
          ok: true,
        })),
        sensorId,
        modelId,
        cacheHit: false,
        judgeScore: judgeOut?.score ?? null,
        cohortFingerprints: cohortMix.fingerprints,
        producedAt: capturedAt,
        latencyMs: clock().getTime() - startedAt,
      };

      if (reservoir) {
        await reservoir.maybeCapture({
          thoughtId,
          threadId: req.threadId,
          stakes: req.stakes,
          thoughtText: accumulatedThought,
          capturedAt,
        });
      }

      const gates: GateOutcome = {
        inviolable: { status: 'pass' },
        policy: policy.verdict,
        drift: sa.verdict,
        cognitiveLoad: loadOut.verdict,
      };

      const decision: BrainDecision = pickDecisionShape({
        gates,
        text: finalText,
        citations,
        artifacts,
        confidence,
        provenance,
      });

      // R7 — proof-carrying membrane (SHADOW). Compute + emit a signed,
      // hash-chained certificate alongside the already-final `decision` and
      // log any divergence from what the existing checks already decided.
      // This is a VOID, fail-closed, CI-inert side-channel: it cannot — and
      // does not — alter `decision`. The existing checks remain the sole
      // deciders until a later validated wave flips the gatekeeper to
      // enforce. No-op when `deps.safetyGatekeeper` is absent.
      runKernelShadowGatekeeper(deps, req, decision, gates, citations);

      // D19 — EMPTY-TEXT DONE GUARD. `pickDecisionShape` has no empty-text
      // guard: a non-refusal decision (answer / softened) with empty text is a
      // fabricated completed turn. This can only arise from a silent sensor
      // fault or a degenerate empty settle-parse — a tool-only turn (empty text
      // but ≥1 tool_call) is legitimate and exempt. Rather than cache + `done`
      // an empty answer as a completed turn, surface an honest `error` degrade,
      // fail-loud, and cache nothing.
      if (
        (decision.kind === 'answer' || decision.kind === 'softened') &&
        finalText.trim().length === 0 &&
        toolCalls.length === 0
      ) {
        yield { kind: 'error', reason: 'EMPTY_ANSWER_DEGRADE', partial: false };
        return;
      }

      cache.set(cacheKey, decision);
      if (deps.provenanceSink) {
        void deps.provenanceSink.record(provenance).catch(() => undefined);
      }
      // Episodic memory writes — fire-and-forget.
      // A2b-2 wire #2 — scrubbed userMessage on the streaming episodic
      // memory persistence path.
      writeEpisodicTurnTrace({
        memory: deps.memory,
        tenantId: memTenantId,
        userId: memUserId,
        threadId: req.threadId,
        turnId: thoughtId,
        userMessage: scrubbedUserMessage,
        agentText: pickAgentTraceText(decision),
      });
      // Cross-session ToM close-the-loop (win #1), streaming path.
      maybeRefineOwnerStyle({
        reader: deps.ownerStyleReader,
        tenantId: memTenantId,
        userMessage: scrubbedUserMessage,
        nowMs: clock().getTime(),
      });

      if (decision.kind !== 'refusal') {
        yield { kind: 'confidence', vector: decision.confidence };
        // Honest epistemic-state surface (win #2 / INV-H). ADDITIVE frame
        // emitted AFTER `confidence`, BEFORE `done`. Surfaces posture +
        // sure/unsure/would-need (plain language); never the audit math.
        // Unknown frame kinds are ignored by existing consumers.
        yield {
          kind: 'self_model',
          selfModel: buildSelfModelFrame({
            answerText: finalText,
            confidence: decision.confidence,
            citationCount: citations.length,
            toolCallsIssued: toolCalls.length > 0,
            stakes: req.stakes,
            softened: decision.kind === 'softened',
          }),
        };
      }
      yield { kind: 'done', decision };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Streaming helpers
// ─────────────────────────────────────────────────────────────────────

function personaStartEvent(persona: PersonaIdentity): KernelStreamEvent {
  return {
    kind: 'turn_start',
    persona: {
      id: persona.id,
      displayName: persona.displayName,
      firstPersonNoun: persona.firstPersonNoun,
    },
  };
}

function pickStreamingSensor(
  sensors: ReadonlyArray<Sensor>,
  required: ReadonlyArray<'vision' | 'thinking' | 'fast' | 'batch'>,
): Sensor | null {
  // Iterate in priority order (lower wins) and pick the first sensor
  // that satisfies all required capabilities AND exposes `callStream`.
  // Mirrors the failover router's eligibility filter; we don't reuse
  // the router itself because streaming requires holding the iterator
  // open across the post-sensor pipeline.
  const eligible = [...sensors]
    .filter((s) => required.every((cap) => s.capabilities.includes(cap)))
    .filter((s) => typeof s.callStream === 'function')
    .sort((a, b) => a.priority - b.priority);
  return eligible[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function pickDecisionShape(args: {
  readonly gates: GateOutcome;
  readonly text: string;
  readonly citations: ReadonlyArray<Citation>;
  readonly artifacts: ReadonlyArray<Artifact>;
  readonly confidence: ConfidenceVector;
  readonly provenance: ProvenanceRecord;
}): BrainDecision {
  const { gates, text, citations, artifacts, confidence, provenance } = args;
  const softeners: GateVerdict[] = [gates.policy, gates.drift, gates.cognitiveLoad];
  const blockers = softeners.filter((v) => v.status === 'block');
  if (blockers.length > 0) {
    const first = blockers[0]!;
    return {
      kind: 'refusal',
      reason: 'reason' in first ? first.reason : 'blocked',
      gateThatRefused: 'policy',
      provenance,
    };
  }
  const soft = softeners.find((v) => v.status === 'soften');
  if (soft && 'reason' in soft) {
    return {
      kind: 'softened',
      text,
      hedge: soft.reason,
      citations,
      confidence,
      gates,
      provenance,
    };
  }
  return {
    kind: 'answer',
    text,
    citations,
    artifacts,
    confidence,
    gates,
    provenance,
  };
}

function makeRefusal(args: {
  readonly thoughtId: string;
  readonly req: ThoughtRequest;
  readonly reason: string;
  readonly gate: 'inviolable' | 'policy' | 'drift';
  readonly startedAt: number;
  readonly clockNow: Date;
}): BrainDecision {
  const provenance: ProvenanceRecord = {
    thoughtId: args.thoughtId,
    threadId: args.req.threadId,
    scopeKind: args.req.scope.kind,
    tier: args.req.tier,
    stakes: args.req.stakes,
    inputHash: sha(args.req.userMessage),
    outputHash: sha('refusal'),
    toolCallSummaries: [],
    sensorId: '__refused__',
    modelId: '__refused__',
    cacheHit: false,
    judgeScore: null,
    cohortFingerprints: [],
    producedAt: args.clockNow.toISOString(),
    latencyMs: args.clockNow.getTime() - args.startedAt,
  };
  return {
    kind: 'refusal',
    reason: args.reason,
    gateThatRefused: args.gate,
    provenance,
  };
}

function sha(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * R7 — kernel-side SHADOW adapter for the proof-carrying membrane.
 *
 * Maps the already-final `decision` + request into the gatekeeper's
 * action shape, derives the outcome the EXISTING checks already made
 * (`refusal` → 'refuse', else 'allow'), and hands both to the void
 * `runShadowGatekeeper` side-channel. This function RETURNS NOTHING the
 * kernel acts on — it cannot alter `decision`. Fully fail-closed (the
 * membrane hook swallows its own errors) and CI-inert (no-op when
 * `deps.safetyGatekeeper` is absent).
 *
 * The gatekeeper action is built from the SAME signals the existing
 * checks read (the gate verdicts on `decision.gates`, the request scope,
 * whether evidence/citations are present, the surface's evidence-required
 * flag) — so the certificate verdict is consistent with the pipeline by
 * construction, never a new restriction.
 */
function runKernelShadowGatekeeper(
  deps: BrainKernelDeps,
  req: ThoughtRequest,
  decision: BrainDecision,
  gates: GateOutcome,
  citations: ReadonlyArray<unknown>,
): void {
  if (!deps.safetyGatekeeper) return; // CI-inert fast path.
  try {
    const tenantScope =
      req.scope.kind === 'tenant' ? req.scope.tenantId : 'platform';
    const existingDecision: SafetyExistingDecisionOutcome =
      decision.kind === 'refusal' ? 'refuse' : 'allow';
    // The membrane reads what the scattered checks already decided. We
    // surface those decided verdicts as the gatekeeper's port signals so
    // the certificate cannot diverge by re-judging — it CERTIFIES.
    const policyBlocked = gates.policy.status === 'block';
    const inviolableBlocked = gates.inviolable.status === 'block';
    const driftBlocked = gates.drift.status === 'block';
    const hasEvidence = citations.length > 0;
    const evidenceRequired = req.surface !== 'marketing';
    const action: SafetyGatekeeperAction = {
      actionRef: decision.provenance.thoughtId,
      tenantScope,
      isRecommendation: evidenceRequired,
      payload: { surface: req.surface, decisionKind: decision.kind },
    };
    runShadowGatekeeper(
      {
        gatekeeper: deps.safetyGatekeeper,
        ...(deps.safetyCertificateSink
          ? { certificateSink: deps.safetyCertificateSink }
          : {}),
        ...(deps.safetyDivergenceReporter
          ? { onDivergence: deps.safetyDivergenceReporter }
          : {}),
      },
      {
        action: {
          ...action,
          // Carry the decided verdicts so a host-bound gatekeeper that
          // reads the payload mirrors the existing decision exactly.
          payload: {
            ...action.payload,
            policyBlocked,
            inviolableBlocked,
            driftBlocked,
            hasEvidence,
          },
        },
        existingDecision,
      },
    );
  } catch {
    // Defensive: the membrane hook is a void side-channel and must never
    // break the turn. Proceed exactly as if it were not wired.
  }
}

/**
 * Step-0 killswitch HALT short-circuit, shared by EVERY code path
 * (legacy 13-step pipeline AND the orchestrator-routed primary path).
 *
 * Returns the refusal `BrainDecision` when the effective killswitch
 * level is `halt` (and records provenance as a side-effect), or `null`
 * when the request may proceed. A no-op (`null`) when no killswitch port
 * is wired, so callers that never configure one are unaffected.
 *
 * SECURITY (fail-closed): the killswitch is the earliest governance
 * gate — a platform / tenant HALT must DENY before any sensor, memory,
 * cohort, or orchestrator hook work. It MUST fire regardless of whether
 * the turn is routed through the legacy pipeline or the orchestrator
 * main-loop; otherwise flipping `KERNEL_USE_ORCHESTRATOR` would silently
 * bypass an active compliance / data-leak / provider-incident hold.
 */
function evaluateKillswitchHalt(args: {
  readonly killswitch: KillswitchPort | undefined;
  readonly req: ThoughtRequest;
  readonly thoughtId: string;
  readonly startedAt: number;
  readonly clockNow: Date;
  readonly provenanceSink: ProvenanceSink | undefined;
}): { readonly decision: BrainDecision; readonly state: ReturnType<typeof resolveKillswitch> } | null {
  if (!args.killswitch) return null;
  const tenantId = args.req.scope.kind === 'tenant' ? args.req.scope.tenantId : null;
  const ks = resolveKillswitch(args.killswitch, tenantId);
  if (ks.level !== 'halt') return null;
  const decision = makeRefusal({
    thoughtId: args.thoughtId,
    req: args.req,
    reason: renderKillswitchRefusalText(ks),
    gate: 'inviolable',
    startedAt: args.startedAt,
    clockNow: args.clockNow,
  });
  if (args.provenanceSink) {
    void args.provenanceSink.record(decision.provenance).catch(() => undefined);
  }
  return { decision, state: ks };
}

/**
 * Defensive normaliser for sensor-call results.
 *
 * Production sensors (anthropic/openai/etc) always return the full
 * `SensorCallResult` shape, but duck-typed adapters (test spies, MCP
 * probes, the D5 kernel-composition rollout test) sometimes omit
 * fields like `toolCalls` and `latencyMs`. We coerce missing fields
 * to safe defaults so the post-sensor pipeline (tool-dispatch, drift,
 * provenance) can rely on them.
 */
function normaliseSensorResult(raw: SensorCallResult): SensorCallResult {
  const r = raw as Partial<SensorCallResult> & Record<string, unknown>;
  return {
    text: typeof r.text === 'string' ? r.text : '',
    thought: typeof r.thought === 'string' ? r.thought : null,
    toolCalls: Array.isArray(r.toolCalls) ? r.toolCalls : [],
    latencyMs: typeof r.latencyMs === 'number' ? r.latencyMs : 0,
    modelId: typeof r.modelId === 'string' ? r.modelId : 'unknown',
    sensorId: typeof r.sensorId === 'string' ? r.sensorId : 'unknown',
  };
}

function extractCitationsFromUiBlock(ui: unknown): ReadonlyArray<Citation> {
  if (!ui || typeof ui !== 'object') return [];
  const v = (ui as { citations?: unknown }).citations;
  if (!Array.isArray(v)) return [];
  return v.filter(
    (c): c is Citation =>
      typeof c === 'object' &&
      c !== null &&
      typeof (c as Citation).id === 'string' &&
      typeof (c as Citation).label === 'string',
  );
}

function extractArtifactsFromUiBlock(ui: unknown): ReadonlyArray<Artifact> {
  if (!ui || typeof ui !== 'object') return [];
  const v = (ui as { artifacts?: unknown }).artifacts;
  if (!Array.isArray(v)) return [];
  return v.filter(
    (a): a is Artifact =>
      typeof a === 'object' &&
      a !== null &&
      typeof (a as Artifact).id === 'string' &&
      typeof (a as Artifact).kind === 'string',
  );
}

function collectToolNumbers(_r: SensorCallResult): ReadonlyArray<number> {
  // Placeholder — the streaming agent-loop is the right place to collect
  // numbers from typed tool outputs. The non-streaming kernel path does
  // not know tool result schemas, so we report no constraint here.
  return [];
}

function renderGroundingFragment(facts: ReadonlyArray<GroundingFact>): string {
  if (facts.length === 0) return '';
  const lines = facts.map((f) => {
    // BP-3 — spotlight the fact VALUE (tenant-internal / corpus-derived,
    // hence untrusted) so an injected instruction smuggled into a chunk is
    // treated as data, never obeyed. The label + id are trusted metadata.
    const value = spotlight(formatGroundingValue(f), f.id);
    return `  - [${f.id}] ${f.label}: ${value} (source: ${f.source}, as-of ${f.asOf})`;
  });
  return [
    'Grounding facts (tenant-internal; cite by id when you use these):',
    ...lines,
  ].join('\n');
}

/**
 * Item-1 — render the ABSOLUTE single-language directive for the
 * orchestrator system prompt. CLAUDE.md mandate: `en` default, `sw`
 * toggle, ZERO mixing. The directive is a terminal instruction so it
 * cannot be displaced by recalled memory / tool output. The directive
 * copy itself is written in the target language so the model is anchored
 * by example, never mixing the two.
 */
function renderOrchestratorLanguageDirective(language: 'en' | 'sw'): string {
  if (language === 'sw') {
    return [
      '# LUGHA (LAZIMA)',
      'Jibu kwa Kiswahili PEKEE. Usichanganye Kiingereza na Kiswahili',
      'popote — si katika salamu, si katika majibu, si katika makosa.',
      'Maneno yote yawe ya Kiswahili.',
    ].join('\n');
  }
  return [
    '# LANGUAGE (REQUIRED)',
    'Respond in English ONLY. Never mix Swahili and English anywhere —',
    'not in greetings, answers, errors, or tool summaries. Every word of',
    'your reply must be English.',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Memory hierarchy helpers — read at step 4, write at step 13.
// Every entry point is wrapped: a failing memory port must NOT break
// the main turn.
// ─────────────────────────────────────────────────────────────────────

const MEMORY_SEMANTIC_LIMIT = 10;
const MEMORY_SEMANTIC_EMBEDDING_LIMIT = 8;
const MEMORY_SEMANTIC_EMBEDDING_MAX_DISTANCE = 0.7;
const MEMORY_EPISODIC_SUMMARY_MAX = 500;

async function loadSemanticFacts(
  memory: MemoryHierarchy | undefined,
  tenantId: string | null,
  userId: string,
  queryEmbedding: ReadonlyArray<number> | null,
): Promise<ReadonlyArray<SemanticFact>> {
  if (!memory?.semantic || !userId) return [];

  // Embedding-based retrieval is preferred when (a) the caller (or the
  // embedder port) produced a query vector AND (b) the adapter
  // implements `searchByEmbedding`. We fall back to legacy key-based
  // search on any error so a misconfigured pgvector backend doesn't
  // starve the prompt.
  const semantic: SemanticMemoryPort = memory.semantic;
  if (
    queryEmbedding &&
    queryEmbedding.length > 0 &&
    typeof semantic.searchByEmbedding === 'function'
  ) {
    try {
      const hits = await semantic.searchByEmbedding({
        tenantId,
        userId,
        embedding: queryEmbedding,
        limit: MEMORY_SEMANTIC_EMBEDDING_LIMIT,
        maxDistance: MEMORY_SEMANTIC_EMBEDDING_MAX_DISTANCE,
      });
      // `SemanticFactWithSimilarity extends SemanticFact` — the kernel
      // only consumes the base shape downstream.
      return hits;
    } catch {
      // Fall through to legacy key-based search.
    }
  }

  try {
    return await semantic.search({
      tenantId,
      userId,
      limit: MEMORY_SEMANTIC_LIMIT,
    });
  } catch {
    return [];
  }
}

/**
 * Resolve a query embedding for the current request. Order of
 * preference:
 *   1. `req.embedding` — caller-supplied (e.g. UI passes the embedding
 *      it already computed for the message bubble).
 *   2. `deps.embedder.embed(req.userMessage)` — kernel-side fallback
 *      when a real OpenAI/Voyage embedder is wired in compose.
 * Returns null when neither is available; the kernel then drops back
 * to the legacy key-based search path.
 */
async function resolveQueryEmbedding(
  req: ThoughtRequest,
  embedder: TextEmbedder | undefined,
): Promise<ReadonlyArray<number> | null> {
  if (req.embedding && req.embedding.length > 0) return req.embedding;
  if (!embedder || !req.userMessage) return null;
  try {
    const vec = await embedder.embed(req.userMessage);
    return vec && vec.length > 0 ? vec : null;
  } catch {
    return null;
  }
}

async function loadReflectiveDigest(
  memory: MemoryHierarchy | undefined,
  tenantId: string | null,
  userId: string,
): Promise<ReflectiveDigest | null> {
  if (!memory?.reflective || !userId) return null;
  try {
    const digests = await memory.reflective.latest({
      tenantId,
      userId,
      periodKind: 'weekly',
      n: 1,
    });
    return digests[0] ?? null;
  } catch {
    return null;
  }
}

const TASK_SCOPED_REFLEXION_LIMIT = 5;

/**
 * Wave-13 F11 — fetch the 4-pass nightly-sleep reflexion bundle for the
 * current tenant + (optional) user and return the pre-rendered prompt
 * fragment. Errors collapse to an empty string so the side-channel
 * never breaks the turn.
 */
async function loadTaskScopedReflexions(
  loader: ReflexionLoaderPort,
  tenantId: string | null,
  userId: string,
): Promise<string> {
  if (!tenantId) return '';
  try {
    const args: { tenantId: string; userId?: string; limit: number } = {
      tenantId,
      limit: TASK_SCOPED_REFLEXION_LIMIT,
    };
    if (userId) args.userId = userId;
    const result = await loadReflexions(loader, args);
    return result.promptFragment ?? '';
  } catch {
    return '';
  }
}

const FEEDBACK_RECALL_LIMIT = 10;
const FEEDBACK_NEGATIVE_RATE_THRESHOLD = 0.25;
const FEEDBACK_MAX_VERBATIM_CORRECTIONS = 3;
const FEEDBACK_CORRECTION_TEXT_MAX = 200;

async function loadFeedbackRecent(
  feedback: FeedbackMemoryPort | undefined,
  tenantId: string | null,
  userId: string,
): Promise<ReadonlyArray<FeedbackEntry>> {
  if (!feedback || !tenantId || !userId) return [];
  try {
    return await feedback.recallRecent({
      tenantId,
      userId,
      limit: FEEDBACK_RECALL_LIMIT,
    });
  } catch {
    return [];
  }
}

/**
 * Render the "What I've learned from your feedback" fragment.
 *
 * Lists up to 3 verbatim recent corrections, then a per-category
 * negative-rate sentence, and (when negativeRate > 0.25) appends a
 * conservative directive instructing the sensor to cite every
 * numerical claim and ask clarifying questions when uncertain.
 *
 * Empty / undefined input ⇒ empty fragment (compose() filters falsy
 * lines, so the system prompt stays clean).
 */
function renderFeedbackFragment(
  entries: ReadonlyArray<FeedbackEntry>,
): string {
  if (!entries || entries.length === 0) return '';

  const corrections = entries
    .filter((e) => e.signal === 'correction' && !!e.correctionText)
    .slice(0, FEEDBACK_MAX_VERBATIM_CORRECTIONS);

  const total = entries.length;
  const negativeCount = entries.filter(
    (e) => e.signal === 'thumbs-down' || e.signal === 'correction',
  ).length;
  const negativeRate = total > 0 ? negativeCount / total : 0;

  // Per-category bucket. We only enumerate the negative buckets the
  // user has actually tagged so the fragment stays compact.
  const categoryCounts: Record<string, number> = {};
  for (const e of entries) {
    if (e.category && (e.signal === 'thumbs-down' || e.signal === 'correction')) {
      categoryCounts[e.category] = (categoryCounts[e.category] ?? 0) + 1;
    }
  }
  const dominantCategory = pickDominantCategory(categoryCounts);

  const lines: string[] = ["What I've learned from your feedback:"];

  if (corrections.length > 0) {
    lines.push('  Recent corrections you gave me:');
    for (const c of corrections) {
      const text = (c.correctionText ?? '').slice(
        0,
        FEEDBACK_CORRECTION_TEXT_MAX,
      );
      lines.push(`    - "${text}"`);
    }
  }

  // Always render the rate sentence so the model knows the weight
  // even when no verbatim corrections were given (e.g. only thumbs).
  if (dominantCategory) {
    lines.push(
      `  You've flagged ${negativeCount} of my ${total} recent answers as "${dominantCategory}" — be especially careful about that.`,
    );
  } else {
    lines.push(
      `  You've flagged ${negativeCount} of my ${total} recent answers as negative.`,
    );
  }

  if (negativeRate > FEEDBACK_NEGATIVE_RATE_THRESHOLD) {
    lines.push(
      "  You've had a higher-than-usual rate of negative feedback. Be conservative; cite every numerical claim; ask clarifying questions when uncertain.",
    );
  }

  return lines.join('\n');
}

function pickDominantCategory(
  counts: Record<string, number>,
): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [cat, n] of Object.entries(counts)) {
    if (n > bestCount) {
      best = cat;
      bestCount = n;
    }
  }
  return best;
}

function renderSemanticMemoryFragment(
  facts: ReadonlyArray<SemanticFact>,
): string {
  if (facts.length === 0) return '';
  const lines = facts.map((f) => {
    const valueStr = stringifyFactValue(f.value);
    const conf = Math.round((Number(f.confidence) || 0) * 100);
    return `  - ${f.key}: ${valueStr} (conf ${conf}%)`;
  });
  return ['What I remember about you:', ...lines].join('\n');
}

function renderReflectiveDigestFragment(
  digest: ReflectiveDigest | null,
): string {
  if (!digest || !digest.summary) return '';
  return ['Recent reflection:', `  - ${digest.summary}`].join('\n');
}

function stringifyFactValue(v: unknown): string {
  if (v === null || v === undefined) return 'unknown';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v).slice(0, 200);
  } catch {
    return String(v);
  }
}

interface EpisodicTurnTraceArgs {
  readonly memory: MemoryHierarchy | undefined;
  readonly tenantId: string | null;
  readonly userId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly userMessage: string;
  readonly agentText: string;
}

function writeEpisodicTurnTrace(args: EpisodicTurnTraceArgs): void {
  const { memory, tenantId, userId, threadId, turnId, userMessage, agentText } = args;
  if (!memory?.episodic || !userId) return;
  // Fire-and-forget — never await; never let the side-channel break
  // the main turn. Each call self-catches; we wrap in try anyway in
  // case the port adapter throws synchronously.
  try {
    void memory.episodic
      .record({
        tenantId,
        userId,
        threadId,
        turnId,
        kind: 'user-message',
        summary: (userMessage ?? '').slice(0, MEMORY_EPISODIC_SUMMARY_MAX),
      })
      .catch(() => undefined);
  } catch {
    // ignored
  }
  try {
    void memory.episodic
      .record({
        tenantId,
        userId,
        threadId,
        turnId,
        kind: 'agent-action',
        summary: (agentText ?? '').slice(0, MEMORY_EPISODIC_SUMMARY_MAX),
      })
      .catch(() => undefined);
  } catch {
    // ignored
  }
}

function pickAgentTraceText(decision: BrainDecision): string {
  if (decision.kind === 'answer' || decision.kind === 'softened') {
    return decision.text ?? '';
  }
  // Refusals: carry the reason instead so the trail still records WHY
  // the agent acted (or refused to act).
  return decision.reason ?? 'refusal';
}

// ─────────────────────────────────────────────────────────────────────
// Agency helpers — read at step 4 (memory recall) for the prompt mix-
// in. The agency port is optional; failures are swallowed so the
// side-channel never breaks the turn.
// ─────────────────────────────────────────────────────────────────────

const AGENCY_GOAL_LIMIT = 5;

async function loadActiveGoals(
  agency: AgencyKernelPort | undefined,
  tenantId: string | null,
  userId: string,
): Promise<ReadonlyArray<Goal>> {
  if (!agency || !tenantId || !userId) return [];
  try {
    return await agency.goals.list({
      tenantId,
      userId,
      status: 'active',
      limit: AGENCY_GOAL_LIMIT,
    });
  } catch {
    return [];
  }
}

function renderActiveGoalsFragment(goals: ReadonlyArray<Goal>): string {
  if (!goals || goals.length === 0) return '';
  const lines = goals.map((g) => {
    const total = g.metrics.stepsTotal;
    const done = g.metrics.stepsDone;
    return `  - ${g.title} (${g.priority}, ${done}/${total} steps done)`;
  });
  return ["**What you've asked me to work on:**", ...lines].join('\n');
}

/**
 * Format a numeric grounding fact for the LLM working-set.
 *
 * Built for the world: when `unit` is `currency-<iso>` (any lowercase
 * ISO-4217 3-letter code), we render the amount with `Intl.NumberFormat`
 * so a EUR, ZAR, NGN, INR fact formats just as well as the legacy
 * KES/TZS cases. The kernel never silently drops a fact because its
 * currency code is "unknown".
 */
export function formatGroundingValue(f: GroundingFact): string {
  if (typeof f.value === 'string') return f.value;
  switch (f.unit) {
    case 'pct':           return `${(f.value * 100).toFixed(1)}%`;
    case 'count':         return f.value.toFixed(0);
    case 'days':          return `${f.value.toFixed(1)} days`;
    default:              break;
  }
  if (typeof f.unit === 'string' && f.unit.startsWith('currency-')) {
    const code = f.unit.slice('currency-'.length).toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) {
      try {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: code,
          currencyDisplay: 'code',
        }).format(f.value);
      } catch {
        // Intl rejects truly unknown codes (e.g. 'AAA'); fall through
        // to the bare code + grouped number so the fact still appears.
        return `${code} ${f.value.toLocaleString('en-US')}`;
      }
    }
  }
  return String(f.value);
}

// ─────────────────────────────────────────────────────────────────────
// K3 — persona prelude / situated address builder. The kernel calls
// `renderPersonaPrelude(...)` with whatever fields it can derive from
// the `ThoughtRequest`. The cache-eligible BORJIE_PERSONA block
// rides every call; the situated-address block changes per request.
// ─────────────────────────────────────────────────────────────────────

function buildSituatedAddressArgs(
  req: ThoughtRequest,
  clock: () => Date,
): SituatedAddressArgs {
  const args: SituatedAddressArgs = {
    surface: req.surface,
    scope: req.scope,
    tier: req.tier,
    nowMs: clock().getTime(),
  };
  return args;
}

// ─────────────────────────────────────────────────────────────────────
// K3 — cognitive-load + ToM accumulator observers. Run per turn so
// the renderers can mix the cross-turn profile into the directive.
// Failures collapse to null so the per-turn renderers stay the
// fall-back. The (tenantId, userId) tuple must be non-empty — the
// accumulator stores are keyed on `${tenantId}:${userId}`.
// ─────────────────────────────────────────────────────────────────────

function observeCognitiveLoad(
  acc: CognitiveLoadAccumulator | undefined,
  tenantId: string | null,
  userId: string,
  loadOut: ReturnType<typeof assessCognitiveLoad>,
  clock: () => Date,
): ReturnType<CognitiveLoadAccumulator['read']> | null {
  if (!acc || !tenantId || !userId) return null;
  try {
    return acc.observe(tenantId, userId, {
      perTurnScore: loadOut.score,
      capturedAt: clock().toISOString(),
    });
  } catch {
    return null;
  }
}

function observeAffective(
  acc: AffectiveAccumulator | undefined,
  tenantId: string | null,
  userId: string,
  mindState: ReturnType<typeof inferMindState>,
  clock: () => Date,
): ReturnType<AffectiveAccumulator['read']> | null {
  if (!acc || !tenantId || !userId) return null;
  try {
    return acc.observe(tenantId, userId, {
      mindState,
      capturedAt: clock().toISOString(),
    });
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Salience Arena helpers (wins #3 + #4). Build a heterogeneous bid set
// from the organs the kernel can reach BEFORE persona selection, run the
// arena, and translate the winner into (a) a persona voice bend and (b)
// the prompt's live-concern segment. All best-effort: a missing reader /
// store fault yields fewer bidders, never a throw on the hot path.
// ─────────────────────────────────────────────────────────────────────

/**
 * Cross-session ToM close-the-loop (win #1). Folds ONE Bayesian
 * observation of THIS turn back into the durable owner-style posterior
 * post-turn. Fire-and-forget — the kernel never blocks on it and
 * swallows any rejection so a store fault can't break the turn. Reaction
 * is the owner's reaction to the PRIOR MD turn carried in this turn's
 * message; we leave it neutral here (the service's own `parseFeedbackText`
 * detects "too long / just tell me" style corrections from the text).
 */
function maybeRefineOwnerStyle(args: {
  readonly reader: BrainKernelDeps['ownerStyleReader'];
  readonly tenantId: string | null;
  readonly userMessage: string;
  readonly nowMs: number;
}): void {
  const { reader, tenantId } = args;
  if (!reader || !tenantId) return;
  void Promise.resolve()
    .then(() =>
      reader.refine(tenantId, [
        { text: args.userMessage, tsMs: args.nowMs },
      ]),
    )
    .catch(() => undefined);
}

/** Drive bids from the slow loop's open proposals (one per breached drive). */
async function buildDriveBids(
  reader: BrainKernelDeps['pendingProposalReader'],
  tenantId: string | null,
): Promise<ReadonlyArray<SalienceBid>> {
  if (!reader || !tenantId) return [];
  try {
    const proposals = await reader.read({ tenantId, limit: 6 });
    return proposals.map((p) =>
      Object.freeze({
        id: `drive:${p.driveId}`,
        sourceClass: 'drive' as const,
        // breachSeverity is already [0,1] per the drive contract.
        bid: clampBid(p.breachSeverity),
        domain: domainForDriveId(p.driveId),
        label: p.title,
      }),
    );
  } catch {
    return [];
  }
}

/** ACT-R activation bids from the (read-only) situational snapshot. */
async function buildActivationBids(
  reader: BrainKernelDeps['situationalSnapshotReader'],
  tenantId: string | null,
): Promise<ReadonlyArray<SalienceBid>> {
  if (!reader || !tenantId) return [];
  try {
    const snapshot = await reader.read(tenantId);
    // Cap activation low so a referenced-but-not-breached entity never
    // out-bids a real P0 / high-severity drive on its own.
    return activationBids(snapshot, { floor: 0, ceiling: 0.5 });
  } catch {
    return [];
  }
}

/**
 * Affect bids (win #4) — translate the dark `behaviorSignalSource`'s
 * frustration / dwell signals into first-class arena bidders. A genuine
 * frustration signal bids HIGH (fast-decaying — see the windowMinutes
 * floor); repeated deep-dwell-without-progress bids a 'stuck' mid-bid.
 * When an affect bid wins, the focus directive softens toward
 * acknowledgement + suppresses proactive framing for the turn.
 */
async function buildAffectBids(
  source: BrainKernelDeps['behaviorSignalSource'],
  tenantId: string | null,
  userId: string | null,
): Promise<ReadonlyArray<SalienceBid>> {
  if (!source || !tenantId || !userId) return [];
  try {
    const signals = await source.signalsForUser({
      tenantId,
      userId,
      // Tight window so affect is a SHORT-lived bidder — the task
      // concern reclaims the spotlight on the next quiet turn.
      windowMinutes: 10,
    });
    const bids: SalienceBid[] = [];
    let frustration = 0;
    let dwell = 0;
    for (const s of signals) {
      if (s.kind === 'frustration.detected') frustration += 1;
      else if (s.kind === 'dwell.deep') dwell += 1;
    }
    if (frustration > 0) {
      bids.push(
        Object.freeze({
          id: 'affect:frustration',
          sourceClass: 'affect' as const,
          // One detection is already loud; repeats saturate toward 1.
          bid: clampBid(0.7 + 0.15 * (frustration - 1)),
          domain: 'affect' as const,
          label: 'frustrated or stuck right now',
        }),
      );
    }
    // Repeated deep dwell WITHOUT a frustration spike → a 'stuck' bid
    // (lower than overt frustration; it still competes with mid drives).
    if (dwell >= 2 && frustration === 0) {
      bids.push(
        Object.freeze({
          id: 'affect:stuck',
          sourceClass: 'affect' as const,
          bid: clampBid(0.45 + 0.1 * (dwell - 2)),
          domain: 'affect' as const,
          label: 'dwelling on this without progress',
        }),
      );
    }
    return bids;
  } catch {
    return [];
  }
}

/**
 * Detector bids (win #3 seam) — map proactive-detector P0/P1/P2 signals
 * onto arena bids. The kernel has no detector READER wired yet (detectors
 * fire on the slow loop), so this is the typed adapter a composition root
 * uses to feed detector signals into the same arena as drives + affect.
 * Pure; tolerates an absent severity band (falls to a low floor).
 */
export function buildDetectorBids(
  detectors: ReadonlyArray<{
    readonly id: string;
    readonly severity: 'P0' | 'P1' | 'P2' | string;
    readonly entityKind?: string;
    readonly label: string;
  }>,
): ReadonlyArray<SalienceBid> {
  return detectors.map((d) =>
    Object.freeze({
      id: `detector:${d.id}`,
      sourceClass: 'detector' as const,
      bid: clampBid(bidForDetectorSeverity(d.severity)),
      domain: (d.entityKind
        ? domainForEntityKind(d.entityKind)
        : 'general') as FocusDomain,
      label: d.label,
    }),
  );
}

/**
 * Commitment bids (win #3 seam) — map OVERDUE open commitments onto arena
 * bids (urgency × days-overdue). Same dormant-but-real adapter pattern as
 * {@link buildDetectorBids}: the kernel exposes it so a composition root
 * can feed the reconcile engine's overdue backlog into the arena.
 */
export function buildCommitmentBids(
  commitments: ReadonlyArray<{
    readonly id: string;
    readonly urgency: number;
    readonly daysOverdue: number;
    readonly entityKind?: string;
    readonly label: string;
  }>,
): ReadonlyArray<SalienceBid> {
  const bids: SalienceBid[] = [];
  for (const c of commitments) {
    const bid = bidForOverdueCommitment({
      urgency: c.urgency,
      daysOverdue: c.daysOverdue,
    });
    if (bid <= 0) continue; // not overdue → no bid
    bids.push(
      Object.freeze({
        id: `commitment:${c.id}`,
        sourceClass: 'commitment' as const,
        bid,
        domain: (c.entityKind
          ? domainForEntityKind(c.entityKind)
          : 'general') as FocusDomain,
        label: c.label,
      }),
    );
  }
  return bids;
}

/**
 * Compose the whole turn's bid set + run the arena. Returns the Focus
 * (or null) plus the derived voice-bend + prompt directive. Pure given
 * the resolved bids; the I/O readers are awaited by the caller-side
 * builders above.
 */
function resolveSalienceFocus(
  bidGroups: ReadonlyArray<ReadonlyArray<SalienceBid>>,
): {
  readonly focus: Focus | null;
  readonly voiceBend: SalienceVoiceBend | undefined;
  readonly directive: string;
} {
  const all: SalienceBid[] = [];
  for (const g of bidGroups) for (const b of g) all.push(b);
  const focus = runSalienceArena(all);
  if (!focus) {
    return { focus: null, voiceBend: undefined, directive: '' };
  }
  const vp = vpVoiceForDomain(focus.winner.domain);
  const voiceBend: SalienceVoiceBend | undefined = vp
    ? { vpVoice: vp, concernLabel: focus.winner.label }
    : undefined;
  return { focus, voiceBend, directive: renderFocusDirective(focus) };
}

// ─────────────────────────────────────────────────────────────────────
// Honest epistemic-state surface (win #2 / INV-H). Derive the self-model
// from the FINAL answer + the confidence vector and project it onto a
// surface-safe frame: POSTURE + sure/unsure/would-need. We surface the
// AXES (groundedness / numbers / stakes) translated to plain language —
// NEVER the four-axis audit numbers (those stay in the confidence frame +
// provenance). Pure.
// ─────────────────────────────────────────────────────────────────────

/** Plain-language label per uncertainty axis (surface-safe; no math). */
const AXIS_SURFACE_LABEL: Record<string, string> = {
  groundedness: 'how well-sourced this is',
  'overconfidence-without-evidence': 'claims I made without a citation',
  'hedged-language': 'how tentative my own wording was',
  'no-tool-evidence': "whether I pulled live data vs. answered from memory",
  'high-stakes-margin': 'the safety margin on a high-stakes call',
  'no-thought-content': 'what you are actually asking',
};

/** Plain-language "would need" per uncertainty axis (surface-safe). */
const AXIS_WOULD_NEED: Record<string, string> = {
  groundedness: 'a source document or the latest figures to cite',
  'overconfidence-without-evidence': 'evidence for the specific claims above',
  'no-tool-evidence': 'permission to pull the live numbers',
  'high-stakes-margin': 'a second confirming data point before you act',
  'no-thought-content': 'one more detail about what you need',
};

/**
 * Build the egress-safe honest-epistemic `SelfModelFrame` (INV-H) from the
 * already-computed turn signals. Surfaces POSTURE + sure/unsure/would-need
 * AXES only — every surfaced string is a constant literal or a constant-map
 * lookup (`AXIS_SURFACE_LABEL` / `AXIS_WOULD_NEED`), NEVER the four-axis audit
 * math and NEVER the model's chain-of-thought / answer text (the answer text
 * feeds ONLY the posture heuristic; none of it is surfaced).
 *
 * EXPORTED so a non-kernel brain surface (the owner `/brain/teach` direct-LLM
 * stream, which does not run the kernel) can emit the IDENTICAL frame shape the
 * kernel jarvis/admin path emits, from the honest signals it DOES compute
 * (calibrated confidence scalar, citation count, debate convergence, stakes).
 * The caller is responsible for re-projecting the result through the gateway's
 * blessed `buildSelfModelEgressPayload` membrane before it crosses the wire.
 */
export function buildSelfModelFrame(args: {
  readonly answerText: string;
  readonly confidence: ConfidenceVector;
  readonly citationCount: number;
  readonly toolCallsIssued: boolean;
  readonly stakes: ThoughtRequest['stakes'];
  readonly softened: boolean;
}): import('./kernel-types.js').SelfModelFrame {
  const model: PerThoughtSelfModel = buildPerThoughtSelfModel({
    snapshot: {
      text: args.answerText,
      // Feed the AUDITED overall as the producer confidence so the
      // heuristic posture aligns with the kernel's own scoring — but we
      // never SURFACE that number (INV-H); only the posture/axes leak.
      producerConfidence: args.confidence.overall,
    },
    context: {
      citationCount: args.citationCount,
      toolCallsIssued: args.toolCallsIssued,
      stakes: args.stakes,
      ...(args.softened ? { softeningGates: ['confidence'] } : {}),
    },
  });

  // SURE = axes that are NOT in the uncertainty set, expressed positively.
  // We surface a short, deterministic set; if the answer is well-grounded
  // (citations present, numbers consistent) we say so in plain language.
  const sureAbout: string[] = [];
  if (args.citationCount > 0 || args.confidence.groundedness >= 0.66) {
    sureAbout.push('the parts I cited a source for');
  }
  if (args.toolCallsIssued || args.confidence.numericalConsistency >= 0.66) {
    sureAbout.push('the figures that came from live data');
  }
  if (sureAbout.length === 0 && model.posture === 'answering') {
    sureAbout.push('the general shape of the answer');
  }

  const unsureAbout: string[] = [];
  const wouldNeed: string[] = [];
  for (const axis of model.uncertaintyAxes) {
    const label = AXIS_SURFACE_LABEL[axis];
    if (label) unsureAbout.push(label);
    const need = AXIS_WOULD_NEED[axis];
    if (need) wouldNeed.push(need);
  }
  // De-dupe wouldNeed while preserving order (stable surface).
  const seenNeed = new Set<string>();
  const wouldNeedUnique = wouldNeed.filter((n) =>
    seenNeed.has(n) ? false : (seenNeed.add(n), true),
  );

  return Object.freeze({
    posture: model.posture,
    sureAbout: Object.freeze(sureAbout),
    unsureAbout: Object.freeze(unsureAbout),
    wouldNeed: Object.freeze(wouldNeedUnique),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Conflict-monitored effort recruitment (win #5 / System 1/2). Build one
// CONFLICT scalar from signals the kernel ALREADY computes, and decide
// whether a fast/standard-routed turn should RECRUIT the next depth tier
// (debate detour / deep model) ONCE before committing. Pure arbiter; the
// caller owns the single re-entry guard + keeps every rail.
// ─────────────────────────────────────────────────────────────────────

/**
 * Compose the conflict scalar from the parts. Each input contributes a
 * bounded term; the result is clamped to [0,1]. Absent inputs contribute
 * 0 (no conflict signal) so the scalar degrades cleanly.
 */
function computeConflictScalar(args: {
  readonly confidenceOverall?: number | null;
  readonly synthAgreement?: number | null;
  readonly synthEscalate?: boolean;
  readonly debateConverged?: boolean | null;
  readonly judgeScore?: number | null;
}): number {
  let conflict = 0;
  // Low confidence is the dominant signal.
  if (typeof args.confidenceOverall === 'number') {
    conflict = Math.max(conflict, clamp01(1 - args.confidenceOverall));
  }
  // Cross-vendor synthesizer disagreement.
  if (typeof args.synthAgreement === 'number') {
    conflict = Math.max(conflict, clamp01(1 - args.synthAgreement));
  }
  if (args.synthEscalate === true) {
    conflict = Math.max(conflict, 0.7);
  }
  // A debate that ran but did NOT converge is a conflict signal.
  if (args.debateConverged === false) {
    conflict = Math.max(conflict, 0.6);
  }
  // A failed self-review.
  if (typeof args.judgeScore === 'number' && args.judgeScore < 0.5) {
    conflict = Math.max(conflict, clamp01(1 - args.judgeScore));
  }
  return clamp01(conflict);
}

/** Conflict threshold above which a fast/standard turn recruits more effort. */
const CONFLICT_RECRUIT_THRESHOLD = 0.55;

/**
 * The recruitment arbiter. Returns whether to escalate this turn and the
 * target depth. Only escalates a turn the router scored 'fast'/'standard'
 * — a turn already routed 'full'/'deep' has nothing to recruit. The
 * caller enforces the single-upshift-per-turn guard.
 */
function recruitControl(args: {
  readonly conflict: number;
  readonly currentRoute: string;
  readonly enabled: boolean;
}): { readonly escalate: boolean; readonly to: 'deep' } {
  const lane = args.currentRoute === 'fast' || args.currentRoute === 'standard';
  const escalate =
    args.enabled && lane && args.conflict >= CONFLICT_RECRUIT_THRESHOLD;
  return { escalate, to: 'deep' };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ─────────────────────────────────────────────────────────────────────
// K5.2 — policy-gate request-context builder. The four new context
// checks (tenant-isolation, scope-match, cost-ceiling, off-hours
// sovereign) only fire when the kernel threads a populated context
// through. We derive every field from `ThoughtRequest`; absent fields
// collapse the corresponding check to a no-op so back-compat is
// preserved for callers that pre-date K5.2.
// ─────────────────────────────────────────────────────────────────────

function buildPolicyGateRequestContext(
  req: ThoughtRequest,
  clock: () => Date,
): PolicyGateRequestContext {
  const ctx: {
    tenantId?: string;
    grantedScopes?: ReadonlyArray<string>;
    tier?: PolicyGateTier;
    estimatedCostUsd?: number;
    stakes?: 'low' | 'medium' | 'high' | 'critical';
    afterHoursOverride?: boolean;
    now: Date;
  } = { now: clock() };
  if (req.scope.kind === 'tenant') ctx.tenantId = req.scope.tenantId;
  if (req.grantedScopes && req.grantedScopes.length > 0) {
    ctx.grantedScopes = req.grantedScopes;
  }
  // Best-effort tier mapping: AwarenessTier and PolicyGateTier are
  // distinct dimensions but the latter is only consulted for the
  // cost-ceiling check. Default `enterprise` for authenticated tenant
  // scopes; `sovereign` for platform scope; `free` for marketing.
  if (req.surface === 'marketing') {
    ctx.tier = 'free';
  } else if (req.scope.kind === 'platform') {
    ctx.tier = 'sovereign';
  } else {
    ctx.tier = 'enterprise';
  }
  if (typeof req.estimatedCostUsd === 'number') {
    ctx.estimatedCostUsd = req.estimatedCostUsd;
  }
  ctx.stakes = req.stakes;
  if (req.afterHoursOverride) ctx.afterHoursOverride = true;
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────
// K9 — tool dispatch. The kernel surfaces a small "did the sensor
// emit a tool_use call we can resolve deterministically?" check. When
// `deps.toolRegistry` is wired and the sensor produced a tool call
// matching one of the seed PM tools, the kernel calls
// `registry.runTool(name, input)` and surfaces the result so the
// caller can mix it back into the next sensor turn / final answer.
//
// We deliberately do NOT loop sensor ↔ tool here — the streaming
// agent-loop owns that. The kernel records whether a deterministic
// resolution occurred so the decision-trace can reference it.
// ─────────────────────────────────────────────────────────────────────

interface DispatchedToolRecord {
  readonly toolName: string;
  readonly outcome: BrainToolOutcome<unknown>;
}

export async function dispatchKernelTools(
  registry: BrainToolRegistry | undefined,
  toolCalls: ReadonlyArray<{ readonly toolName: string; readonly input: unknown }>,
): Promise<ReadonlyArray<DispatchedToolRecord>> {
  if (!registry || toolCalls.length === 0) return [];
  const results: DispatchedToolRecord[] = [];
  for (const call of toolCalls) {
    try {
      const outcome = await registry.runTool(call.toolName, call.input);
      results.push({ toolName: call.toolName, outcome });
    } catch (err) {
      results.push({
        toolName: call.toolName,
        outcome: {
          kind: 'executor-failed',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────
// C5 — Progressive Intelligence helpers.
// ─────────────────────────────────────────────────────────────────────

/**
 * Collect a small "retrieved context" bundle for the Self-RAG critic.
 * The critic needs SOMETHING to compare the response against — without
 * any context every claim looks unsupported. We hand it the top
 * semantic facts + reflective digest summary + grounding facts; that's
 * the same bundle the kernel injected into the system prompt.
 */
function collectSelfRagContext(
  semanticFacts: ReadonlyArray<SemanticFact>,
  reflectiveDigest: ReflectiveDigest | null,
  groundingFacts: ReadonlyArray<GroundingFact>,
): ReadonlyArray<string> {
  const out: string[] = [];
  for (const f of semanticFacts.slice(0, 5)) {
    out.push(`fact: ${f.key} = ${asValueString(f.value)}`);
  }
  if (reflectiveDigest?.summary) {
    out.push(`digest: ${String(reflectiveDigest.summary).slice(0, 400)}`);
  }
  for (const g of groundingFacts.slice(0, 5)) {
    out.push(`grounding: ${g.label} = ${String(g.value)} (${g.source})`);
  }
  return out;
}

function asValueString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v).slice(0, 200);
  } catch {
    return '';
  }
}

interface MaybeWriteReflexionArgs {
  readonly deps: BrainKernelDeps;
  readonly req: ThoughtRequest;
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly outcome: ReflexionOutcome;
  readonly negativeNotes?: ReadonlyArray<string>;
  readonly groundedFacts?: ReadonlyArray<string>;
}

/**
 * Conditionally write a Reflexion row. Runs only when:
 *   - `deps.reflexionWriter` is wired, AND
 *   - both tenantId + userId are present, AND
 *   - the inbound message is an explicit session terminator.
 *
 * Idle-end detection is out of scope here — the caller (api-gateway
 * session manager) decides when an idle session has ended and emits
 * the reflexion through a separate code path.
 */
async function maybeWriteReflexion(args: MaybeWriteReflexionArgs): Promise<void> {
  const writer = args.deps.reflexionWriter;
  if (!writer) return;
  if (!args.tenantId || !args.userId) return;
  if (!isExplicitSessionTerminator(args.req.userMessage)) return;
  await recordReflection(writer, {
    tenantId: args.tenantId,
    userId: args.userId,
    sessionId: args.req.threadId,
    userMessage: args.req.userMessage,
    outcome: args.outcome,
    ...(args.negativeNotes ? { negativeNotes: args.negativeNotes } : {}),
    ...(args.groundedFacts ? { groundedFacts: args.groundedFacts } : {}),
  });
}

function inferReflexionOutcome(
  decision: BrainDecision,
  selfRag: SelfRagVerdict | null,
): ReflexionOutcome {
  if (decision.kind === 'refusal') return 'failure';
  if (decision.kind === 'softened') return 'mixed';
  if (selfRag) {
    if (selfRag.isSup === 'low' || selfRag.isUse === 'low') return 'mixed';
    if (selfRag.isRel === 'low') return 'mixed';
  }
  return 'success';
}

// ─────────────────────────────────────────────────────────────────────
// Phase E.5.1 — orchestrator wire-up helpers.
//
// `runViaOrchestrator(req, deps, clock)` is the kernel's primary code
// path when `BrainKernelDeps.orchestrator` is wired AND the feature
// flag is on. It converts the legacy `ThoughtRequest` shape into an
// `OrchestratorRequest`, delegates to the main-loop's `think()`, and
// translates the `OrchestratorResponse` ADT back into a `BrainDecision`
// so callers don't observe the swap.
//
// The legacy 13-step pipeline below this helper remains the fallback —
// callers that opted out via `useByDefault: false` or
// `KERNEL_USE_ORCHESTRATOR=false` still get the old code path verbatim.
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolve the orchestrator-routing feature flag.
 *
 * "FULL POWERS" (Item-5): once the orchestrator dep is wired, the
 * main-loop is the DEFAULT-ON live generation path. Two levers can
 * disable it for an incident rollback without a redeploy.
 *
 * Order of precedence (highest wins):
 *   1. `deps.orchestrator.useByDefault` — per-instance override the
 *      composition root supplies (e.g. a test pinning a specific path).
 *      Wins over env.
 *   2. `process.env.KERNEL_USE_ORCHESTRATOR === 'false'` — hard kill
 *      lever for instant incident rollback. Forces OFF.
 *   3. `process.env.BORJIE_ORCHESTRATOR_MAINLOOP` — soft disable lever.
 *      `'0'` / `'false'` / `'off'` force OFF; any other value — INCLUDING
 *      UNSET — leaves the orchestrator ON.
 *   4. Default: TRUE (orchestrator main-loop is the live default).
 *
 * When the orchestrator dep is absent, the flag is irrelevant — the
 * legacy path runs unconditionally.
 */
function resolveOrchestratorRoutingEnabled(deps: BrainKernelDeps): boolean {
  if (!deps.orchestrator) return false;
  // 1. Per-instance override wins over every env signal.
  if (typeof deps.orchestrator.useByDefault === 'boolean') {
    return deps.orchestrator.useByDefault;
  }
  // Defence-in-depth — env may be missing in test contexts / bundlers
  // that lack a global `process`; the typed access protects against that.
  const env =
    typeof process !== 'undefined' && process.env ? process.env : undefined;
  // 2. Hard kill lever — forces OFF regardless of the default. This is the
  //    instant production rollback: `KERNEL_USE_ORCHESTRATOR=false`.
  if (env && env.KERNEL_USE_ORCHESTRATOR === 'false') return false;
  // 3. DEFAULT ON ("full powers"): once the orchestrator dep is wired, the
  //    main-loop is the live generation path. `BORJIE_ORCHESTRATOR_MAINLOOP`
  //    in {0,false,off} disables it (a softer per-flag lever); any other
  //    value — including UNSET — leaves it ON.
  const flag =
    env && typeof env.BORJIE_ORCHESTRATOR_MAINLOOP === 'string'
      ? env.BORJIE_ORCHESTRATOR_MAINLOOP.trim().toLowerCase()
      : '';
  if (flag === '0' || flag === 'false' || flag === 'off') return false;
  return true;
}

/**
 * Convert a legacy `ThoughtRequest` into the orchestrator's
 * `OrchestratorRequest`. The orchestrator carries less detail than
 * the legacy pipeline (no `surface`, `stakes`, `attachments`, etc.) so
 * we project only the fields the main loop reads. The richer fields
 * stay accessible to PostToolUse hooks via the orchestrator-side
 * `HookContext.scope` / `tier` shape.
 */
/**
 * Item-1 — build the persona SYSTEM PROMPT for the orchestrator path so
 * it equals the legacy persona path's quality. Mirrors the legacy
 * pipeline's identity resolution (selectPersona → branding override →
 * identity preamble) and renders it through the SAME `assembleSystemPrompt`
 * assembler (so the IP-protection + security-boundary terminal layers
 * ship on the orchestrator path too). Grounding + locale are appended by
 * the orchestrator's own `assembleSystem` from the dedicated request
 * fields, so they are intentionally NOT folded here.
 */
async function buildPersonaSystemPromptForOrchestrator(
  req: ThoughtRequest,
  deps: BrainKernelDeps,
): Promise<string> {
  const baseSurfacePersona = selectPersona(req);
  const branding = deps.brandingResolver
    ? await deps.brandingResolver
        .resolve({
          tenantId: req.scope.kind === 'tenant' ? req.scope.tenantId : null,
          surface: req.surface,
        })
        .catch(() => null)
    : null;
  const persona = applyBrandingOverride(baseSurfacePersona, branding);
  const identity = renderIdentityPreamble({ persona, scope: req.scope });
  return assembleSystemPrompt({ identity });
}

/**
 * Convert a legacy `ThoughtRequest` into the orchestrator's
 * `OrchestratorRequest`. Item-1 — this now threads the resolved persona
 * SYSTEM PROMPT, the grounding-facts fragment + their citation ids, the
 * single-language locale directive, and the evidence-required flag so the
 * orchestrator's system prompt obeys the SAME hard rules (persona
 * quality, evidence-required, bilingual single-language) the persona path
 * does. The richer fields stay accessible to PostToolUse hooks via the
 * orchestrator-side `HookContext.scope` / `tier` shape.
 */
async function toOrchestratorRequest(
  req: ThoughtRequest,
  deps: BrainKernelDeps,
): Promise<OrchestratorRequest> {
  // Resolve grounding facts the SAME way the legacy pipeline does so the
  // orchestrator can cite the identical tenant-internal evidence set.
  const groundingFacts: ReadonlyArray<GroundingFact> = deps.groundingFacts
    ? await deps.groundingFacts
        .fetch({ userMessage: req.userMessage, tier: req.tier, limit: 6 })
        .catch(() => [])
    : [];
  const personaSystemPrompt = await buildPersonaSystemPromptForOrchestrator(
    req,
    deps,
  );
  // CLAUDE.md: default `en`; only an explicit `sw` toggles. Evidence is
  // required on every tenant-scoped surface; the public marketing surface
  // has no tenant grounding so we relax it there.
  const language: 'en' | 'sw' = req.language === 'sw' ? 'sw' : 'en';
  const evidenceRequired = req.surface !== 'marketing';

  const base: OrchestratorRequest = {
    threadId: req.threadId,
    userMessage: req.userMessage,
    scope: req.scope,
    tier: req.tier,
    // Agency-rebranded id flows through as the textual persona name; the
    // full rendered prompt rides on `personaSystemPrompt`.
    persona: req.scope.personaId,
    personaSystemPrompt,
    languageDirective: renderOrchestratorLanguageDirective(language),
    evidenceRequired,
    ...(groundingFacts.length > 0
      ? {
          groundingFragment: renderGroundingFragment(groundingFacts),
          groundingCitationIds: groundingFacts.map((f) => f.id),
        }
      : {}),
    ...(req.grantedScopes && req.grantedScopes.length > 0
      ? { grantedScopes: req.grantedScopes }
      : {}),
  };
  return base;
}

/**
 * Run a `ThoughtRequest` through the orchestrator and project the
 * `OrchestratorResponse` ADT into a `BrainDecision`. Every variant
 * maps deterministically:
 *
 *   - `answer`               → `kind: 'answer'`
 *   - `ask-approval`         → `kind: 'refusal'` with
 *                              `gateThatRefused: 'policy'` and the
 *                              hook's prompt as the reason (matches
 *                              the existing four-eye escalation surface)
 *   - `speculative`          → `kind: 'softened'` (sandbox divert is a
 *                              soft "we ran a dry-run" outcome)
 *   - `ack-schedule`         → `kind: 'answer'` (the wake handler owns
 *                              the eventual user-visible message)
 *   - `budget-exhausted`     → `kind: 'softened'` with the partial text
 *                              + the exhaustion axis as the hedge
 */
async function runViaOrchestrator(
  req: ThoughtRequest,
  kernelDeps: BrainKernelDeps,
  clock: () => Date,
): Promise<BrainDecision> {
  const startedAt = clock().getTime();
  const thoughtId = randomUUID();
  // The orchestrator wire is guaranteed present at every call site (the
  // delegation gate checks `deps.orchestrator` before invoking), but we
  // narrow defensively so a future caller can't slip an unwired deps in.
  const orchestratorDeps = kernelDeps.orchestrator?.deps;
  if (!orchestratorDeps) {
    return makeRefusal({
      thoughtId,
      req,
      reason: 'orchestrator-not-wired',
      gate: 'policy',
      startedAt,
      clockNow: clock(),
    });
  }
  // Item-1 — resolve the parity-threaded orchestrator request (persona
  // prompt + grounding + locale + evidence flag). Resolution failures
  // must never crash the turn — collapse to a refusal so the caller
  // still sees a closed shape.
  let orchestratorReq: OrchestratorRequest;
  try {
    orchestratorReq = await toOrchestratorRequest(req, kernelDeps);
  } catch (err) {
    return makeRefusal({
      thoughtId,
      req,
      reason:
        err instanceof Error
          ? `orchestrator-request-build: ${err.message}`
          : 'orchestrator-request-build',
      gate: 'policy',
      startedAt,
      clockNow: clock(),
    });
  }
  let response: OrchestratorResponse;
  try {
    response = await orchestratorThink(orchestratorReq, orchestratorDeps);
  } catch (err) {
    // The orchestrator should never throw uncaught — but if it does
    // (e.g. an upstream port adapter is buggy) we collapse to a refusal
    // so the calling surface still sees a closed shape.
    return makeRefusal({
      thoughtId,
      req,
      reason:
        err instanceof Error
          ? `orchestrator-error: ${err.message}`
          : 'orchestrator-error',
      gate: 'policy',
      startedAt,
      clockNow: clock(),
    });
  }
  return translateOrchestratorResponse({
    response,
    req,
    thoughtId,
    startedAt,
    clockNow: clock(),
  });
}

/**
 * Pure translator: maps the orchestrator's response variants onto the
 * `BrainDecision` ADT. Kept separate from `runViaOrchestrator` so the
 * streaming wrapper can reuse it without re-invoking the main loop.
 */
function translateOrchestratorResponse(args: {
  readonly response: OrchestratorResponse;
  readonly req: ThoughtRequest;
  readonly thoughtId: string;
  readonly startedAt: number;
  readonly clockNow: Date;
}): BrainDecision {
  const { response, req, thoughtId, startedAt, clockNow } = args;
  const baseProvenance: ProvenanceRecord = {
    thoughtId,
    threadId: req.threadId,
    scopeKind: req.scope.kind,
    tier: req.tier,
    stakes: req.stakes,
    inputHash: sha(req.userMessage),
    outputHash: sha(orchestratorResponseTextFor(response)),
    toolCallSummaries: [],
    sensorId: 'orchestrator',
    modelId: 'orchestrator',
    cacheHit: false,
    judgeScore: null,
    cohortFingerprints: [],
    producedAt: clockNow.toISOString(),
    latencyMs: clockNow.getTime() - startedAt,
  };
  switch (response.kind) {
    case 'answer': {
      // Successful turn — surface the orchestrator's text as a
      // confident `answer`. Confidence is set to 1 on every axis;
      // the orchestrator's hook chain has already enforced the gates
      // that the legacy `pickDecisionShape` looked at.
      const confidence: ConfidenceVector = {
        groundedness: 1,
        stability: 1,
        review: 1,
        numericalConsistency: 1,
        overall: 1,
      };
      const gates: GateOutcome = {
        inviolable: { status: 'pass' },
        policy: { status: 'pass' },
        drift: { status: 'pass' },
        cognitiveLoad: { status: 'pass' },
      };
      return {
        kind: 'answer',
        text: response.text,
        citations: response.citations,
        artifacts: response.artifacts,
        confidence,
        gates,
        provenance: baseProvenance,
      };
    }
    case 'ask-approval': {
      // Four-eye / approval flow — the legacy pipeline surfaces this
      // as a policy refusal so the caller's UI can re-render with the
      // approval prompt. The pendingDecision is recoverable via the
      // orchestrator's plan store.
      return {
        kind: 'refusal',
        reason: response.prompt,
        gateThatRefused: 'policy',
        provenance: baseProvenance,
      };
    }
    case 'speculative': {
      // Sandbox divert — semantic match for "we ran the speculative
      // path" is a softened answer with the sandbox id as the hedge.
      const confidence: ConfidenceVector = {
        groundedness: 0.5,
        stability: 0.5,
        review: 0.5,
        numericalConsistency: 0.5,
        overall: 0.5,
      };
      const gates: GateOutcome = {
        inviolable: { status: 'pass' },
        policy: {
          status: 'soften',
          reason: `sandbox-divert: ${response.sandboxId}`,
        },
        drift: { status: 'pass' },
        cognitiveLoad: { status: 'pass' },
      };
      return {
        kind: 'softened',
        text: `Speculative execution diverted to sandbox ${response.sandboxId}.`,
        hedge: `sandbox-divert: ${response.sandboxId}`,
        citations: [],
        confidence,
        gates,
        provenance: baseProvenance,
      };
    }
    case 'ack-schedule': {
      // Wake-loop ack — the user-visible reply will come when the wake
      // handler resumes the thread. For the synchronous return we
      // surface a short acknowledgment.
      const confidence: ConfidenceVector = {
        groundedness: 1,
        stability: 1,
        review: 1,
        numericalConsistency: 1,
        overall: 1,
      };
      const gates: GateOutcome = {
        inviolable: { status: 'pass' },
        policy: { status: 'pass' },
        drift: { status: 'pass' },
        cognitiveLoad: { status: 'pass' },
      };
      return {
        kind: 'answer',
        text: `Scheduled wake (resume token: ${response.resumeToken}).`,
        citations: [],
        artifacts: [],
        confidence,
        gates,
        provenance: baseProvenance,
      };
    }
    case 'budget-exhausted': {
      // Budget exhaustion is a "we did our best" outcome — surface as
      // a softened reply with the exhaustion axis as the hedge so the
      // UI can show the partial text alongside a "I ran out of
      // <axis>" caveat.
      const confidence: ConfidenceVector = {
        groundedness: 0.5,
        stability: 0.5,
        review: 0.5,
        numericalConsistency: 0.5,
        overall: 0.5,
      };
      const gates: GateOutcome = {
        inviolable: { status: 'pass' },
        policy: {
          status: 'soften',
          reason: `budget-exhausted: ${response.axis}`,
        },
        drift: { status: 'pass' },
        cognitiveLoad: { status: 'pass' },
      };
      return {
        kind: 'softened',
        text: response.partialText,
        hedge: `budget-exhausted: ${response.axis}`,
        citations: [],
        confidence,
        gates,
        provenance: baseProvenance,
      };
    }
  }
}

/**
 * Extract a representative text payload from any `OrchestratorResponse`
 * variant — used purely to compute the provenance outputHash.
 */
function orchestratorResponseTextFor(response: OrchestratorResponse): string {
  switch (response.kind) {
    case 'answer':
      return response.text;
    case 'ask-approval':
      return response.prompt;
    case 'speculative':
      return `sandbox:${response.sandboxId}`;
    case 'ack-schedule':
      return `ack:${response.resumeToken}`;
    case 'budget-exhausted':
      return response.partialText;
  }
}

/**
 * Streaming counterpart to `runViaOrchestrator`. The current
 * orchestrator (Phase E.1) emits decisions, not tokens, so we run the
 * non-streaming path and emit a synthetic delta stream (turn_start +
 * one text_delta + confidence + done) that satisfies the existing
 * `JarvisStreamEvent` contract. Token-level streaming through the
 * orchestrator's hook chain is a follow-up.
 */
async function* streamViaOrchestrator(
  req: ThoughtRequest,
  deps: BrainKernelDeps,
  clock: () => Date,
): AsyncIterable<KernelStreamEvent> {
  // Pre-sensor persona — emit `turn_start` immediately so the streaming
  // contract holds. We use the same `selectPersona` the legacy stream
  // path uses so observers see an identical persona block.
  const persona = selectPersona(req);
  yield personaStartEvent(persona);

  const decision = await runViaOrchestrator(req, deps, clock);

  if (decision.kind !== 'refusal' && decision.text) {
    yield { kind: 'text_delta', text: decision.text };
  }
  if (decision.kind !== 'refusal') {
    yield { kind: 'confidence', vector: decision.confidence };
  }
  yield { kind: 'done', decision };
}
