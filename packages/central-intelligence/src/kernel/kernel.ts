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
import { renderModuleInventoryBlock } from './self-awareness.js';
import { scoreConfidence } from './confidence.js';
import { normalize } from './normalizer.js';
import { type BrainCache, thoughtCacheKey, createBrainCache } from './brain-cache.js';
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
  type OrchestratorDeps,
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
  readonly groundingFacts?: GroundingFactsProvider;
  readonly priorTurnsLoader?: (threadId: string) => Promise<
    ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>
  >;
  readonly recentTurnCounter?: (threadId: string) => Promise<number>;
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
   * register zero groundedness against the property-management
   * vocabulary detector (KES/lease/rent/...). Callers that wire a
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
}

export interface BrainKernel {
  think(req: ThoughtRequest): Promise<BrainDecision>;
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
  thinkStream(req: ThoughtRequest): AsyncIterable<KernelStreamEvent>;
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
    async think(req) {
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
        try {
          const result = await runViaOrchestrator(
            req,
            deps.orchestrator.deps,
            clock,
          );
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

      // 1) brain-side cache
      const cacheStart = clock().getTime();
      const cached = cache.get(cacheKey);
      if (cached) {
        traceStep('cache', cacheStart, 'hit');
        finaliseTrace(cached.kind);
        return cached;
      }
      traceStep('cache', cacheStart, 'miss');

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

      // 6) identity + theory-of-mind + cognitive-load.
      // Branding override (if any) is applied BEFORE personalisation /
      // preamble rendering so an agency-level rename or preamble flows
      // through the rest of the pipeline (drift detection, audit) under
      // the rebranded id.
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
      const moduleInventory = renderModuleInventoryBlock();

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
      const mindDirective = affectiveProfile
        ? renderMindStateDirectiveWithProfile(mindState, affectiveProfile)
        : renderMindStateDirective(mindState);

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

      const system = [
        personaPrelude,
        '',
        // Wave-13 F11 — "Recent self-critiques" sits at the top of the
        // system prompt (just below the persona anchor) so the model
        // reads the crystallised lessons BEFORE the rest of the
        // context. Empty string is filtered out below.
        taskScopedReflexionFragment
          ? `**Recent self-critiques**\n${taskScopedReflexionFragment}`
          : '',
        '',
        identity,
        '',
        rolloutPromptFragment,
        '',
        moduleInventory,
        '',
        `Locus: ${locusPhrase(req.tier, req.scope)}.`,
        '',
        `Behavioural directive: ${mindDirective}`,
        `Verbosity directive: ${loadDirective}`,
        '',
        renderSemanticMemoryFragment(semanticFacts),
        '',
        renderReflectiveDigestFragment(reflectiveDigest),
        '',
        reflexionFragment,
        '',
        renderFeedbackFragment(feedbackRecent),
        '',
        renderActiveGoalsFragment(activeGoals),
        '',
        renderGroundingFragment(groundingFacts),
        '',
        learnedSkillsFragment,
        '',
        cohortMix.promptFragment,
      ]
        .filter(Boolean)
        .join('\n');

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
        // egress.
        sensorResult = await router.call(
          {
            system,
            systemPrompt: system,
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

      // Defensive normalisation — duck-typed sensor adapters (test
      // spies, MCP probes) may return a partial result without
      // `toolCalls` / `latencyMs`. Coerce missing fields here so the
      // post-sensor pipeline never null-derefs downstream.
      sensorResult = normaliseSensorResult(sensorResult);

      // 7b) tool dispatch — when the sensor emitted a `tool_use` call
      // matching a seed PM tool AND a registry is wired, resolve it
      // deterministically. The result is recorded on the trace so ops
      // can audit which deterministic resolution backed which sensor
      // suggestion. The kernel does NOT loop sensor↔tool here — the
      // streaming agent-loop owns that.
      const toolDispatchResults = await dispatchKernelTools(
        deps.toolRegistry,
        sensorResult.toolCalls.map((tc) => ({
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
          'Improve grounding, hedge uncited numbers, and match the property-ops voice.';
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
      if (
        (req.stakes === 'high' || req.stakes === 'critical') &&
        req.estimatedCostUsd === undefined &&
        debateRoundsCompleted === undefined
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
        action: 'collect_deposit' | 'issue_eviction_notice' | 'raise_rent' | 'distrain_goods' | 'enter_premises' | 'evict' | 'recover_arrears';
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

      cache.set(cacheKey, decision);
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
    async *thinkStream(req: ThoughtRequest): AsyncIterable<KernelStreamEvent> {
      // Phase E.5.1 — orchestrator-routed streaming. When wired + flag
      // on, the orchestrator's non-streaming `think()` runs and we
      // translate the final answer into the legacy `JarvisStreamEvent`
      // shape so the kernel's streaming contract is preserved. Token-
      // level streaming through the orchestrator's hook chain is a
      // follow-up (E1 emits decisions, not tokens). The translation
      // layer still emits at least: turn_start, ≥1 text_delta,
      // confidence (when present), done.
      if (orchestratorRoutingEnabled && deps.orchestrator) {
        yield* streamViaOrchestrator(req, deps.orchestrator.deps, clock);
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
      const moduleInventory = renderModuleInventoryBlock();

      const mindState = inferMindState(req.userMessage);
      const affectiveProfile = observeAffective(
        deps.affectiveAccumulator,
        memTenantId,
        memUserId,
        mindState,
        clock,
      );
      const mindDirective = affectiveProfile
        ? renderMindStateDirectiveWithProfile(mindState, affectiveProfile)
        : renderMindStateDirective(mindState);

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

      const system = [
        personaPrelude,
        '',
        identity,
        '',
        rolloutPromptFragment,
        '',
        moduleInventory,
        '',
        `Locus: ${locusPhrase(req.tier, req.scope)}.`,
        '',
        `Behavioural directive: ${mindDirective}`,
        `Verbosity directive: ${loadDirective}`,
        '',
        renderSemanticMemoryFragment(semanticFacts),
        '',
        renderReflectiveDigestFragment(reflectiveDigest),
        '',
        renderFeedbackFragment(feedbackRecent),
        '',
        renderActiveGoalsFragment(activeGoals),
        '',
        renderGroundingFragment(groundingFacts),
        '',
        cohortMix.promptFragment,
      ]
        .filter(Boolean)
        .join('\n');

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
      const sensorArgs: SensorCallArgs = {
        system,
        systemPrompt: system,
        userMessage: scrubbedUserMessage,
        priorTurns,
        extendedThinking: wantsThinking,
        stakes: req.stakes,
        ...(req.attachments ? { attachments: req.attachments } : {}),
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
        } catch {
          sensorLatencyMs = clock().getTime() - sensorStart;
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

      if (decision.kind !== 'refusal') {
        yield { kind: 'confidence', vector: decision.confidence };
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
    const value = formatGroundingValue(f);
    return `  - [${f.id}] ${f.label}: ${value} (source: ${f.source}, as-of ${f.asOf})`;
  });
  return [
    'Grounding facts (tenant-internal; cite by id when you use these):',
    ...lines,
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
 * Order of precedence (highest wins):
 *   1. `deps.orchestrator.useByDefault` — per-instance override the
 *      composition root supplies (e.g. canary lever).
 *   2. `process.env.KERNEL_USE_ORCHESTRATOR` — ops env-var lever.
 *      Treats the literal string `'false'` as "disable"; everything
 *      else (including unset) means "enable when wired".
 *   3. Default: TRUE when the orchestrator dep is wired.
 *
 * When the orchestrator dep is absent, the flag is irrelevant — the
 * legacy path runs unconditionally.
 */
function resolveOrchestratorRoutingEnabled(deps: BrainKernelDeps): boolean {
  if (!deps.orchestrator) return false;
  if (typeof deps.orchestrator.useByDefault === 'boolean') {
    return deps.orchestrator.useByDefault;
  }
  // Defence-in-depth — env may be missing in test contexts. We avoid
  // reading process.env when running in environments that lack a
  // global `process` (e.g. some bundlers); the typed access protects
  // against that.
  const envFlag =
    typeof process !== 'undefined' &&
    process.env &&
    typeof process.env.KERNEL_USE_ORCHESTRATOR === 'string'
      ? process.env.KERNEL_USE_ORCHESTRATOR
      : undefined;
  if (envFlag === 'false') return false;
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
function toOrchestratorRequest(req: ThoughtRequest): OrchestratorRequest {
  const base: {
    threadId: string;
    userMessage: string;
    scope: ThoughtRequest['scope'];
    tier: ThoughtRequest['tier'];
    persona: string;
    grantedScopes?: ReadonlyArray<string>;
  } = {
    threadId: req.threadId,
    userMessage: req.userMessage,
    scope: req.scope,
    tier: req.tier,
    // The legacy pipeline derives the persona from `selectPersona(req)`
    // off the surface; the orchestrator only needs a textual persona
    // name for the system-prompt assembly. We pass the personaId
    // straight from the scope so an agency-rebranded id flows through.
    persona: req.scope.personaId,
  };
  if (req.grantedScopes && req.grantedScopes.length > 0) {
    base.grantedScopes = req.grantedScopes;
  }
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
  deps: OrchestratorDeps,
  clock: () => Date,
): Promise<BrainDecision> {
  const startedAt = clock().getTime();
  const thoughtId = randomUUID();
  const orchestratorReq = toOrchestratorRequest(req);
  let response: OrchestratorResponse;
  try {
    response = await orchestratorThink(orchestratorReq, deps);
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
  deps: OrchestratorDeps,
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
