/**
 * Kernel types — the disciplined cognitive layer above the streaming
 * agent loop. A single `think(request)` call traverses a 13-step
 * pipeline and returns a BrainDecision with provenance, confidence,
 * and gating verdicts attached.
 *
 * The kernel is provider-agnostic and storage-agnostic. Every side-
 * effect (LLM calls, audit writes, CoT sampling, drift recording) is
 * routed through an injected port so unit tests run pure.
 */

import type { ScopeContext, Citation, Artifact } from '../types.js';
import type {
  EpisodicMemoryPort,
  SemanticMemoryPort,
  ProceduralMemoryPort,
  ReflectiveMemoryPort,
} from './memory/types.js';
import type { FeedbackMemoryPort } from './feedback/types.js';

// Re-export the feedback port so callers reaching the kernel-types
// barrel get the structural type alongside MemoryHierarchy.
export type {
  FeedbackEntry,
  FeedbackMemoryPort,
  FeedbackRecallArgs,
  FeedbackSignal,
} from './feedback/types.js';

// ─────────────────────────────────────────────────────────────────────
// Awareness scopes — tier-scoped visibility bubbles richer than the
// binary tenant/platform split. A request lives at exactly one tier;
// the kernel uses the tier to gate which tools, memory indexes, and
// cohort signals are reachable.
// ─────────────────────────────────────────────────────────────────────

export type AwarenessTier =
  | 'tenant'           // single tenant inside one lease
  | 'lease'            // one lease (one or more tenants)
  | 'unit'             // one unit (multiple leases over time)
  | 'block'            // one block (multiple units)
  | 'property'         // one property (one or more blocks)
  | 'portfolio'        // one owner's properties
  | 'org'              // one estate-management org
  | 'industry';        // platform-wide DP-aggregate scope

// ─────────────────────────────────────────────────────────────────────
// ThoughtRequest — the single input to think().
// ─────────────────────────────────────────────────────────────────────

/**
 * Multimodal attachment carried alongside a textual user message.
 *
 * For now only `kind: 'image'` is supported — base64-encoded image bytes
 * forwarded to a vision-capable Sensor (e.g. Claude Opus / Sonnet / Haiku
 * with vision). The Anthropic sensor adapter rebuilds the user-message
 * `content` block as a multipart array per Anthropic's multimodal spec
 * when one or more attachments are present.
 *
 * IMPORTANT — inviolable / PII handling:
 *   The inviolable refusal gate currently inspects ONLY `userMessage` text.
 *   Image-side checks (e.g. an ID document image carrying PII) are flagged
 *   for follow-up; until that gate is added, callers SHOULD pre-redact /
 *   side-channel-classify image attachments before passing them in.
 */
export interface ThoughtAttachment {
  readonly kind: 'image';
  readonly mediaType:
    | 'image/png'
    | 'image/jpeg'
    | 'image/gif'
    | 'image/webp';
  /** Base64-encoded image bytes (NO data-URL prefix). */
  readonly data: string;
  /** Optional human-readable caption / filename for audit + UI display. */
  readonly caption?: string;
}

export interface ThoughtRequest {
  readonly threadId: string;
  readonly userMessage: string;
  readonly scope: ScopeContext;
  readonly tier: AwarenessTier;
  /** Stakes drives extended-thinking, judge pass, full CoT capture. */
  readonly stakes: 'low' | 'medium' | 'high' | 'critical';
  /** Surface where the reply will render — affects voice + verbosity. */
  readonly surface:
    | 'marketing'
    | 'tenant-app'
    | 'owner-portal'
    | 'estate-manager-app'
    | 'admin-portal'
    | 'platform-hq'
    | 'classroom';
  /** When true, request a self-review judge pass before returning. */
  readonly requireJudge?: boolean;
  /**
   * Optional multimodal attachments (lease scans, property photos,
   * damage assessment images). When present, the kernel adds `'vision'`
   * to the sensor capability requirement for this turn.
   */
  readonly attachments?: ReadonlyArray<ThoughtAttachment>;
  /**
   * Optional sha256-hash of the requester's IP + a server salt. Carried
   * through ONLY for the unauthenticated marketing surface so the
   * public-inviolable gate + the public rate-limit middleware can
   * correlate refusals to a hashed origin without storing the raw IP.
   * Authenticated surfaces leave this `undefined`.
   */
  readonly ipHash?: string;
  /**
   * Optional caller-supplied embedding vector for the current
   * `userMessage`. When present (or when the kernel's optional
   * `embedder` port produces one), the memory-recall step prefers
   * `memory.semantic.searchByEmbedding(...)` over the legacy key-based
   * `search(...)` so retrieval can return semantically-near facts
   * rather than prefix-matched keys. Dimensionality is producer-side
   * (OpenAI text-embedding-3-small = 1536); the kernel does not
   * validate dimensionality here — the adapter does.
   */
  readonly embedding?: ReadonlyArray<number>;
  /**
   * Optional caller-supplied cost estimate for this turn in USD.
   * Threaded into the policy-gate request context so the cost-ceiling
   * check (K5.2) can fire BEFORE the kernel commits the answer.
   */
  readonly estimatedCostUsd?: number;
  /**
   * Optional caller-supplied granted-scope set. Threaded into the
   * policy-gate request context so the scope-match check (K5.2) can
   * compare against the action's `requiredScopes`. Defence-in-depth
   * complement to the prompt-shield + autonomy-policy.
   */
  readonly grantedScopes?: ReadonlyArray<string>;
  /**
   * Optional override flag accepting off-hours risk explicitly. When
   * absent the policy gate's off-hours check refuses sovereign-tier
   * (`stakes: 'critical'`) actions outside EAT business hours.
   */
  readonly afterHoursOverride?: boolean;
  /**
   * Deep-reasoning toggle. When `true` AND the kernel has a
   * `MultiLLMSynthesizerPort` wired, the sensor step (7) is replaced
   * with a mixture-of-agents fan-out across N proposer models followed
   * by a Claude-Opus synthesis. Used for "I really need a calibrated
   * answer" code paths: legal-adjacent advice, owner-payout strategy,
   * rent-increase letters, eviction-letter drafting.
   *
   * Defaults to `false` so existing callers keep the single-shot sensor
   * path. The synthesizer is a side-channel — when wired but flag is
   * off, the kernel never spends budget on it. When flag is on but the
   * synthesizer fails, the kernel falls back to the single-shot sensor
   * path (logged on the decision trace).
   *
   * Distinct from `debate`:
   *   - `debate` runs N voices × R rounds with a sequential-critic
   *     pattern, intended for "advocate vs. critic vs. devil's
   *     advocate" deliberation.
   *   - `requireSynthesis` runs N providers ONCE in parallel and merges,
   *     intended for cross-vendor blind-spot reduction (Anthropic +
   *     OpenAI + DeepSeek). Cheaper, lower-variance, and the synthesis
   *     output carries a Jaccard agreement score the caller can use
   *     to escalate when proposers diverge.
   */
  readonly requireSynthesis?: boolean;
  /**
   * Wave-13 F2 — optional intended action namespace string (e.g.
   * `md:create-lease`, `md:adjust-invoice`, `md:read-tenant`). When
   * the kernel is wired with `BrainKernelDeps.tierPolicy`, this
   * field is fed to `assertTierPolicy(role, action)` BEFORE the
   * sensor call. Absent action ⇒ tier-policy gate is a no-op.
   */
  readonly action?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Multi-LLM synthesizer port — duck-typed so the central-intelligence
// package does not pick up a hard dep on `@borjie/ai-copilot`. The
// composition root wires the real
// `createMultiLLMSynthesizer(...)` (Anthropic + OpenAI + DeepSeek
// proposers + Claude Opus synthesizer) and the kernel calls
// `synthesize(args)` when `req.requireSynthesis === true` lands on a
// turn whose `stakes` warrants the cost.
// ─────────────────────────────────────────────────────────────────────

export interface MultiLLMSynthesizerCall {
  /** System prompt the kernel composed at step 6. */
  readonly systemPrompt: string;
  /** User-facing message — kernel passes the PII-scrubbed text. */
  readonly userMessage: string;
  /** Prior turns the kernel already assembled. */
  readonly priorTurns: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly content: string;
  }>;
  /** Stakes — synthesizer adapters may use this to gate mode (jury vs. merge). */
  readonly stakes: ThoughtRequest['stakes'];
  /** Synthesis mode hint — adapter may override. */
  readonly mode?: 'merge' | 'jury' | 'race-verify';
}

export interface MultiLLMSynthesizerResult {
  /** Final synthesized text. Treated as a sensor output by the kernel. */
  readonly content: string;
  /** Number of proposers that returned a usable answer. */
  readonly proposerSuccessCount: number;
  /** Number of proposers that failed. */
  readonly proposerFailureCount: number;
  /** Agreement score [0, 1] across proposers' outputs. */
  readonly agreement: number;
  /** True iff agreement fell below the synthesizer's min threshold. */
  readonly escalate: boolean;
  /** True iff synthesizer LLM failed and we fell back to a proposer. */
  readonly synthesizerFallback: boolean;
  /** Model id of the synthesizer (or the fallback proposer). */
  readonly modelId: string;
  /** Total wall-clock latency for the whole fan-out + synthesis. */
  readonly latencyMs: number;
}

/**
 * Decision the kernel uses to gate the synthesizer detour. Adapters
 * own the proposer/synthesizer construction so the kernel stays
 * provider-agnostic; the kernel only owns the "should I" decision
 * (driven by `req.requireSynthesis`).
 */
export interface MultiLLMSynthesizerPort {
  /**
   * Optional gate. When omitted, the kernel runs the synthesizer
   * whenever `req.requireSynthesis === true`. Adapters can override
   * to enforce a tier ceiling (e.g. skip on `stakes==='low'`).
   */
  shouldSynthesize?(req: ThoughtRequest): boolean;
  /** Fan-out + synthesize. Errors propagate; the kernel catches. */
  synthesize(args: MultiLLMSynthesizerCall): Promise<MultiLLMSynthesizerResult>;
}

// ─────────────────────────────────────────────────────────────────────
// Text embedder port — optional dependency for the memory-recall step.
// Composition roots that wire a real OpenAI / Voyage / local embedder
// pass this in; the kernel uses it to produce a query embedding from
// the user message when the caller did not supply one. The kernel
// never blocks on the embedder — failures collapse to the legacy
// key-based search path so retrieval still works.
// ─────────────────────────────────────────────────────────────────────

export interface TextEmbedder {
  embed(text: string): Promise<ReadonlyArray<number>>;
}

// ─────────────────────────────────────────────────────────────────────
// Confidence vector — composite scoring attached to every decision.
// All components ∈ [0,1]; overall = min(components) by default.
// ─────────────────────────────────────────────────────────────────────

export interface ConfidenceVector {
  readonly groundedness: number;       // fraction of claims with citations
  readonly stability: number;          // similarity to a re-roll of the same prompt
  readonly review: number;             // judge pass score, 1 if no judge ran
  readonly numericalConsistency: number; // numbers match tool outputs
  readonly overall: number;            // min(...components)
}

// ─────────────────────────────────────────────────────────────────────
// Gating verdicts — each layer that may block / soften / pass an output.
// ─────────────────────────────────────────────────────────────────────

export type GateVerdict =
  | { readonly status: 'pass' }
  | { readonly status: 'soften'; readonly reason: string }
  | { readonly status: 'block';  readonly reason: string };

export interface GateOutcome {
  readonly inviolable: GateVerdict;
  readonly policy: GateVerdict;
  readonly drift: GateVerdict;
  readonly cognitiveLoad: GateVerdict;
}

// ─────────────────────────────────────────────────────────────────────
// Provenance — what went into the decision. Hashed + redacted before
// storage by the audit recorder.
// ─────────────────────────────────────────────────────────────────────

export interface ProvenanceRecord {
  readonly thoughtId: string;
  readonly threadId: string;
  readonly scopeKind: ScopeContext['kind'];
  readonly tier: AwarenessTier;
  readonly stakes: ThoughtRequest['stakes'];
  readonly inputHash: string;
  readonly outputHash: string;
  readonly toolCallSummaries: ReadonlyArray<{
    readonly toolName: string;
    readonly latencyMs: number;
    readonly ok: boolean;
  }>;
  readonly sensorId: string;
  readonly modelId: string;
  readonly cacheHit: boolean;
  readonly judgeScore: number | null;
  readonly cohortFingerprints: ReadonlyArray<string>;
  readonly producedAt: string;
  readonly latencyMs: number;
  /**
   * Number of debate rounds completed when the kernel routed the
   * sensor call through the optional debate hook. Absent when the
   * single-shot sensor path was used.
   */
  readonly debateRoundsCompleted?: number;
  /**
   * Whether the debate's last two rounds converged (jaccard ≥ 0.8).
   * Absent when the single-shot sensor path was used.
   */
  readonly debateConverged?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// BrainDecision — the single output of think(). Closed shape so
// callers can pattern-match without ambiguity.
// ─────────────────────────────────────────────────────────────────────

/**
 * Marker attached to a `BrainDecision` when the kernel is operating in a
 * degraded mode — sensor failover, breaker open, or a not-yet-wired tool
 * surfaced an error. Propagates through the gateway → SDK → chat UI so
 * the operator and the end user see the same fallback signal.
 */
export interface DegradedDecisionMarker {
  readonly reason: string;
  readonly affected_capabilities: ReadonlyArray<string>;
  /** ISO timestamp of the entry into degraded mode. */
  readonly since?: string;
}

export type BrainDecision =
  | {
      readonly kind: 'answer';
      readonly text: string;
      readonly citations: ReadonlyArray<Citation>;
      readonly artifacts: ReadonlyArray<Artifact>;
      readonly confidence: ConfidenceVector;
      readonly gates: GateOutcome;
      readonly provenance: ProvenanceRecord;
      readonly degraded?: DegradedDecisionMarker;
    }
  | {
      readonly kind: 'refusal';
      readonly reason: string;
      readonly gateThatRefused: 'inviolable' | 'policy' | 'drift';
      readonly provenance: ProvenanceRecord;
      readonly degraded?: DegradedDecisionMarker;
    }
  | {
      readonly kind: 'softened';
      readonly text: string;
      readonly hedge: string;
      readonly citations: ReadonlyArray<Citation>;
      readonly confidence: ConfidenceVector;
      readonly gates: GateOutcome;
      readonly provenance: ProvenanceRecord;
      readonly degraded?: DegradedDecisionMarker;
    };

// ─────────────────────────────────────────────────────────────────────
// Sensor — a multi-provider abstraction over LlmAdapter. Health is
// tracked externally by sensor-failover.
// ─────────────────────────────────────────────────────────────────────

export interface SensorCallArgs {
  readonly system: string;
  /**
   * Alias of `system`. Some sensor adapters (and the D5 rollout-
   * composition tests) read the composed prompt off `systemPrompt`
   * rather than `system`. The kernel populates both with the same
   * value so adapters can use whichever field matches their existing
   * upstream contract.
   */
  readonly systemPrompt?: string;
  readonly userMessage: string;
  readonly priorTurns: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  readonly extendedThinking: boolean;
  readonly stakes: ThoughtRequest['stakes'];
  /**
   * Optional multimodal attachments. When non-empty, the sensor adapter
   * rebuilds the user message into a multipart content array with the
   * images first and the text last. Sensor must declare `'vision'` in
   * its capabilities for the router to pick it.
   */
  readonly attachments?: ReadonlyArray<ThoughtAttachment>;
}

export interface SensorCallResult {
  readonly text: string;
  readonly thought: string | null;
  readonly toolCalls: ReadonlyArray<{ toolName: string; input: unknown; callId: string }>;
  readonly latencyMs: number;
  readonly modelId: string;
  readonly sensorId: string;
}

export interface Sensor {
  readonly id: string;
  readonly modelId: string;
  readonly priority: number;          // lower wins
  readonly capabilities: ReadonlyArray<'vision' | 'thinking' | 'fast' | 'batch'>;
  call(args: SensorCallArgs): Promise<SensorCallResult>;
  /**
   * Optional token-level streaming entry point. When implemented, the
   * kernel's `thinkStream(req)` forwards delta events to the consumer
   * in real time. Sensors that cannot stream omit this and the kernel
   * falls back to a single-shot `call()` followed by post-hoc chunking.
   */
  callStream?(args: SensorCallArgs): AsyncIterable<SensorStreamEvent>;
}

// ─────────────────────────────────────────────────────────────────────
// Streaming events — emitted by `Sensor.callStream` and aggregated by
// `BrainKernel.thinkStream`. The shape is provider-agnostic; provider
// adapters map upstream SSE events into this union.
// ─────────────────────────────────────────────────────────────────────

export type SensorStreamEvent =
  | { readonly kind: 'turn_start'; readonly modelId: string; readonly sensorId: string }
  | { readonly kind: 'text_delta'; readonly text: string }
  | { readonly kind: 'thought_delta'; readonly text: string }
  | {
      readonly kind: 'tool_call';
      readonly toolName: string;
      readonly input: unknown;
      readonly callId: string;
    }
  | {
      readonly kind: 'stop';
      readonly stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
      readonly latencyMs: number;
    };

// ─────────────────────────────────────────────────────────────────────
// KernelStreamEvent — the union emitted by `BrainKernel.thinkStream`.
// Pre-sensor refusals collapse to `turn_start` + `done`. A successful
// turn emits at least: turn_start, ≥1 text_delta, confidence, done.
// ─────────────────────────────────────────────────────────────────────

export type KernelStreamEvent =
  | {
      readonly kind: 'turn_start';
      readonly persona: {
        readonly id: string;
        readonly displayName: string;
        readonly firstPersonNoun: string;
      };
    }
  | { readonly kind: 'text_delta'; readonly text: string }
  | { readonly kind: 'thought_delta'; readonly text: string }
  | {
      readonly kind: 'gate_verdict';
      readonly gate: 'inviolable' | 'drift' | 'policy' | 'cognitive-load';
      readonly verdict: GateVerdict;
    }
  | { readonly kind: 'confidence'; readonly vector: ConfidenceVector }
  | { readonly kind: 'done'; readonly decision: BrainDecision };

// ─────────────────────────────────────────────────────────────────────
// CoT reservoir — sampled chain-of-thought for audit replay.
// ─────────────────────────────────────────────────────────────────────

export interface CotSample {
  readonly thoughtId: string;
  readonly threadId: string;
  readonly stakes: ThoughtRequest['stakes'];
  /** PII-scrubbed thought text safe to persist. */
  readonly thoughtText: string;
  /**
   * SHA-256 (hex) of the original, pre-scrub thought text. Lets a
   * regulator confirm that two thoughts on the same thread had the
   * same prompt without needing the raw bytes.
   */
  readonly promptHash?: string;
  /** SHA-256 (hex) of the sanitised text actually stored in thoughtText. */
  readonly responseHash?: string;
  readonly capturedAt: string;
}

export interface CotReservoirSink {
  capture(sample: CotSample): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Persona drift — recorded when self-awareness flags voice violations.
// ─────────────────────────────────────────────────────────────────────

export interface PersonaDriftEvent {
  readonly thoughtId: string;
  readonly personaId: string;
  readonly violationType: 'taboo' | 'first-person-loss' | 'tone' | 'fabrication';
  readonly excerpt: string;
  readonly severity: 'low' | 'medium' | 'high';
  readonly detectedAt: string;
}

export interface PersonaDriftSink {
  record(event: PersonaDriftEvent): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Provenance sink — persists ProvenanceRecord. Production binds the
// `kernel_provenance` Postgres table; tests use an in-memory recorder.
// ─────────────────────────────────────────────────────────────────────

export interface ProvenanceSink {
  record(record: ProvenanceRecord): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Grounding facts — domain-specific data points the kernel pre-fetches
// and mixes into the system prompt so the sensor answers from real
// state, not from training memory. Distinct from cohort signals: these
// are tenant-internal (occupancy, arrears, work-orders), not DP-
// aggregate cross-tenant statistics.
// ─────────────────────────────────────────────────────────────────────

/**
 * Currency unit token for `GroundingFact.unit` — `currency-<iso>` where
 * `<iso>` is a lowercase ISO-4217 3-letter code. e.g. `currency-tzs`,
 * `currency-eur`, `currency-zar`. The kernel's fact-formatter parses
 * the code out of the token and uses `Intl.NumberFormat` to render the
 * amount with the right symbol / decimals / grouping.
 */
export type GroundingFactCurrencyUnit = `currency-${string}`;

export interface GroundingFact {
  /** Stable id; used as a citation token in the rendered prompt. */
  readonly id: string;
  readonly label: string;
  readonly value: string | number;
  /** Optional unit for numeric values. */
  readonly unit?: 'pct' | 'count' | GroundingFactCurrencyUnit | 'days';
  /** Source identifier — table name, service name, etc. */
  readonly source: string;
  readonly asOf: string;
}

export interface GroundingFactsProvider {
  fetch(args: {
    readonly userMessage: string;
    readonly tier: AwarenessTier;
    readonly limit: number;
  }): Promise<ReadonlyArray<GroundingFact>>;
}

// ─────────────────────────────────────────────────────────────────────
// Memory hierarchy — the LITFIN-style four-tier persistent memory the
// kernel reads from at step 4 (memory recall) and writes to at step 13
// (provenance write). Every port is optional; the kernel runs with any
// subset wired.
// ─────────────────────────────────────────────────────────────────────

export interface MemoryHierarchy {
  readonly episodic?: EpisodicMemoryPort;
  readonly semantic?: SemanticMemoryPort;
  readonly procedural?: ProceduralMemoryPort;
  readonly reflective?: ReflectiveMemoryPort;
}

// ─────────────────────────────────────────────────────────────────────
// Online-learning feedback port — the brain's "growth" pattern.
// Re-exported here so `kernel-types` is the single barrel callers
// import from when wiring kernel deps. The full structural definition
// lives in `./feedback/types.ts`. Mirrors LITFIN's feedback loop and
// closes the "stock LLMs are STATIC" assessment gap.
// ─────────────────────────────────────────────────────────────────────

// (FeedbackMemoryPort, FeedbackEntry, FeedbackSignal are re-exported at
// the top of this file alongside the memory imports.)
export type _FeedbackMemoryPortMarker = FeedbackMemoryPort;

// ─────────────────────────────────────────────────────────────────────
// Agency port — optional. When wired, the kernel's step 4 (memory
// recall) reads the user's ACTIVE goals and mixes them into the system
// prompt as "**What you've asked me to work on:**" so the next turn
// references the persistent objective stack. The full executor +
// wake-loop live above the kernel; the kernel only consumes the goals
// reader for prompt mix-in.
//
// The full agency surface (typed write-tools, executor, wake-loop) is
// re-exported under the kernel's `agency` namespace; this port is the
// minimal slice the kernel itself needs.
// ─────────────────────────────────────────────────────────────────────

import type {
  ExecutorOutcome,
  GoalsPort,
  PlanDecomposerArgs,
  PlanDecomposerDeps,
  DecomposedStep,
} from './agency/index.js';

export interface AgencyKernelPort {
  readonly goals: GoalsPort;
  readonly executor: { executeGoal(id: string): Promise<ExecutorOutcome> };
  readonly planDecomposer: (
    args: PlanDecomposerArgs,
    deps: PlanDecomposerDeps,
  ) => Promise<ReadonlyArray<DecomposedStep>>;
}

export type _AgencyKernelPortMarker = AgencyKernelPort;

// ─────────────────────────────────────────────────────────────────────
// Behavior-signal source — Central Command Phase A (C4 Brain Skin).
//
// When wired, the kernel's step 4 (memory recall) reads recent
// derived behaviour signals (engagement.high / frustration.detected /
// task.completed-without-AI / dwell.deep) from the sensorium-event-log
// aggregator and mixes them into the system prompt as the brain's
// mind-state inference channel. The full aggregator lives in
// `@borjie/ai-copilot/ambient-brain` and is duck-typed here so
// the central-intelligence package stays dep-free.
// ─────────────────────────────────────────────────────────────────────

export interface BehaviorSignalShape {
  readonly kind: string;
  readonly route: string;
  readonly capturedAt: string;
  readonly evidence?: Readonly<Record<string, number>>;
}

export interface BehaviorSignalSourcePort {
  signalsForUser(args: {
    readonly tenantId: string;
    readonly userId: string;
    readonly windowMinutes?: number;
  }): Promise<ReadonlyArray<BehaviorSignalShape>>;
  signalsForSession(args: {
    readonly tenantId: string;
    readonly userId: string;
    readonly sessionId: string;
    readonly windowMinutes?: number;
  }): Promise<ReadonlyArray<BehaviorSignalShape>>;
}

export type _BehaviorSignalSourcePortMarker = BehaviorSignalSourcePort;
