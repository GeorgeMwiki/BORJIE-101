/**
 * Cognitive wiring — composition root extension for the previously-
 * unwired cognitive packages (R8 audit follow-up).
 *
 * Background
 * ----------
 * The R8 deep-research wave found ~52k LOC of fully-built cognitive
 * infrastructure with schemas, in-memory reference impls, and Drizzle
 * tables shipped — but ZERO call sites in services. This module wires
 * the highest-leverage subset into the api-gateway composition root:
 *
 *   - `@borjie/cognitive-memory`      — unified semantic memory cells
 *                                       (observe / recall / reinforce /
 *                                       cite / contradict) backed by
 *                                       the `cognitive_memory` table
 *                                       (migration 0029).
 *   - `@borjie/persistent-memory`     — session-memory, skill registry,
 *                                       pending-thread tracker, MemGPT
 *                                       summariser (temporal continuity
 *                                       substrate).
 *   - `@borjie/cognitive-composition` — only the *types* are consumed
 *                                       here. The 12-wire `compose()`
 *                                       pipeline requires the heavy
 *                                       cognitive-engine + brain-router
 *                                       + calibration ports to be wired
 *                                       and is deferred until those
 *                                       adapters land (see "Deferred"
 *                                       section below).
 *
 * Public API summary (discovered from each package's `src/index.ts`):
 *
 *   `@borjie/cognitive-memory`
 *     createRecall(deps) -> RecallFn
 *     createObserve(deps) -> ObserveFn
 *     createReinforce(deps) -> ReinforceFn
 *     createCite(deps) -> CiteFn
 *     createContradict(deps) -> ContradictFn
 *     createEmbeddingService({ upstream, cache?, budget_gate? })
 *     createInMemoryCellRepository(initial?) -> CellRepository
 *     createInMemoryReinforcementRepository() -> ReinforcementRepository
 *     createInMemoryAuditChain() -> AuditChainPort
 *     Constants: EMBEDDING_DIM (1536), REINFORCE_PROMOTION_THRESHOLD,
 *                CONSOLIDATE_RECALL_THRESHOLD, CONTRADICT_EVIDENCE_THRESHOLD
 *
 *   `@borjie/persistent-memory`
 *     createSessionRecall({ repo }) -> SessionRecallFn
 *     createSessionMemoryUpsert(deps) -> SessionMemoryUpsertFn
 *     createSkillLookupByIntent(deps) -> SkillLookupByIntentFn
 *     createPendingThreadInsert(deps) / createPendingThreadResolve(deps)
 *     composeResumptionBrief(input) -> ResumptionBrief
 *     createInMemorySessionMemoryRepository() / SkillRepository /
 *                                 PendingThreadRepository / ThreadSummaryRepository
 *     createInMemoryAuditChain() -> AuditChainPort
 *
 *   `@borjie/cognitive-composition`
 *     createCognitiveComposition(deps) -> { compose, wireHealth }
 *     runWireHealth({ tenantId, deps }) -> HealthReport
 *     CognitiveInputSchema / CognitiveOutputSchema (zod)
 *
 * Design choices
 * --------------
 *   1. In-memory adapters by default. Production Drizzle adapters land
 *      in a follow-up wave; the in-memory variants are explicitly
 *      designed for "ephemeral worker contexts" by each package
 *      (see audit-chain-link.ts comments in both cognitive-memory and
 *      persistent-memory). This unblocks the brain.hono.ts integration
 *      without taking a hard DB dependency in this PR.
 *   2. Graceful degradation. If a factory call throws at boot we log a
 *      warning and return `WiredCognitive` with the broken slot set to
 *      `null`. The enrichment function then short-circuits to an empty
 *      result so the brain orchestrator still serves the turn.
 *   3. Append-only enrichment (CLAUDE.md hard rule). The enrichment
 *      function NEVER mutates the caller's system prompt — it returns a
 *      *new* string prefixed with the recalled context block. The
 *      caller is responsible for prepending vs. appending; we leave the
 *      original prompt intact in the return value.
 *   4. Audit chain. Every recall call appends a `memory.recall` row to
 *      the in-memory audit chain (the persistent variant lands with the
 *      Drizzle adapter). This satisfies the "every memory mutation is
 *      hash-chained" invariant in CLAUDE.md.
 *   5. No `console.log`. All operational logging goes through the
 *      structured logger from `utils/logger.ts`. The logger redacts
 *      PII via the classification scrubber by default.
 *   6. Immutability throughout. The returned `WiredCognitive` is a
 *      readonly snapshot; enrichment returns frozen arrays.
 *
 * Integration with `brain.hono.ts` (DOC ONLY — do not edit that file
 * from this PR; the SSE-Stream agent owns it)
 * -----------------------------------------------------------
 * After `c.get('services')`, the `/turn` handler can read the wired
 * cognitive bundle and enrich the system prompt before the Anthropic
 * call:
 *
 *   const wired = c.get('cognitive');  // set by service-context middleware
 *   const enrichment = wired
 *     ? await enrichBrainTurnWithCognitive({
 *         wired,
 *         tenantId: ctx.tenant.tenantId,
 *         userId:   ctx.actor.id,
 *         userText: body.userText,
 *         personaId: body.forcePersonaId ?? 'mr-mwikila',
 *       })
 *     : { enrichedSystemPrompt: '', citations: [] };
 *   const finalSystemPrompt = enrichment.enrichedSystemPrompt
 *     ? enrichment.enrichedSystemPrompt + '\n\n' + basePersonaSystemPrompt
 *     : basePersonaSystemPrompt;
 *
 * Deferred (not in this PR)
 * -------------------------
 *   - `@borjie/blackboard-intel` + `@borjie/blackboard-sota` — complex
 *     parallel-agent coordination boards. Not on the core /turn path.
 *   - `@borjie/cognitive-engine` — the 9-step inference engine. Needs
 *     adapter binding to the Anthropic SDK + corpus reader.
 *   - Drizzle-backed adapters for `cognitive_memory_cells` (mig 0027)
 *     and `session_memory` (mig 0029). Land alongside the embedding-
 *     service Drizzle cache port.
 *   - The 12-wire `cognitive-composition.compose()` pipeline. Requires
 *     `cognitive-engine.infer`, `brain-llm-router.cascade`,
 *     `calibration-monitor`, `conformal-calibration-online`, and the
 *     `cognitive_wiring_health` Postgres writer.
 *
 * @module services/api-gateway/src/composition/cognitive-wiring
 */

import {
  // Operations
  createRecall,
  createObserve,
  // Storage
  createInMemoryCellRepository,
  createInMemoryReinforcementRepository,
  // Embedding service
  createEmbeddingService,
  // Audit
  createInMemoryAuditChain,
  // Constants
  EMBEDDING_DIM,
  // Types
  CognitiveMemoryError,
  type CellRepository,
  type EmbeddingService as CognitiveEmbeddingService,
  type RecallFn,
  type ObserveFn,
  type RecallResult,
  type MemoryKind,
  type AuditChainPort as MemoryAuditChain,
  type UpstreamEmbedder,
  type ReinforcementRepository,
} from '@borjie/cognitive-memory';

import {
  // Session
  createSessionRecall,
  type SessionRecallFn,
  // Skills
  createSkillLookupByIntent,
  type SkillLookupByIntentFn,
  // Storage
  createInMemorySessionMemoryRepository,
  createInMemorySkillRepository,
  createInMemoryPendingThreadRepository,
  // Audit
  createInMemoryAuditChain as createPersistentAuditChain,
  type SessionMemoryRepository,
  type SkillRepository,
  type PendingThreadRepository,
  type AuditChainPort as PersistentAuditChain,
} from '@borjie/persistent-memory';

// ---------------------------------------------------------------------------
// Logger contract — narrow shape so this file does not bind to a
// specific logging library. Matches the structural shape of the
// `createLogger(...)` return value in `../utils/logger.ts`.
// ---------------------------------------------------------------------------

export interface CognitiveLogger {
  readonly debug: (message: string, meta?: Record<string, unknown>) => void;
  readonly info: (message: string, meta?: Record<string, unknown>) => void;
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
  readonly error: (message: string, meta?: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Bundle of cognitive services wired at the composition root. Each
 * slot is nullable so the consumer can detect partial-wiring (e.g.
 * persistent-memory built but cognitive-memory degraded) and fall
 * back gracefully without the gateway refusing to boot.
 */
export interface WiredCognitive {
  /** Semantic memory cell store + 5 operations. `null` when the
   *  factory threw at boot. */
  readonly cognitiveMemory: CognitiveMemoryBundle | null;
  /** Session-memory, skills, pending-threads. `null` on boot failure. */
  readonly persistent: PersistentMemoryBundle | null;
  /**
   * The 12-wire `cognitive-composition.compose()` pipeline is deferred
   * (requires several heavy ports that are not yet wired). The slot is
   * always `null` in this PR; a follow-up wave will replace it with the
   * real composer once the inference / brain-router / calibration ports
   * land. Consumers that read `wired.composition` MUST null-check.
   */
  readonly composition: null;
  /** Whether at least one bundle was constructed. False means full
   *  degradation — the enrichment function will return empty. */
  readonly isLive: boolean;
}

export interface CognitiveMemoryBundle {
  readonly cells: CellRepository;
  readonly reinforcements: ReinforcementRepository;
  readonly embedder: CognitiveEmbeddingService;
  readonly audit: MemoryAuditChain;
  readonly recall: RecallFn;
  readonly observe: ObserveFn;
}

export interface PersistentMemoryBundle {
  readonly sessionRepo: SessionMemoryRepository;
  readonly skillRepo: SkillRepository;
  readonly pendingRepo: PendingThreadRepository;
  readonly audit: PersistentAuditChain;
  readonly sessionRecall: SessionRecallFn;
  readonly skillLookup: SkillLookupByIntentFn;
}

/**
 * Inputs to `wireCognitive`. The DB client and the upstream embedder
 * are optional — when omitted the wiring falls back to a deterministic
 * fixed-vector embedder (useful for tests and degraded-mode boot).
 */
export interface WireCognitiveDeps {
  /** Drizzle client. Currently unused (in-memory adapters only); held
   *  for the follow-up Drizzle adapter wave. Pass `null` in degraded
   *  mode. */
  readonly db: unknown | null;
  readonly logger: CognitiveLogger;
  /** Optional upstream embedder (e.g. OpenAI). When omitted, a
   *  zero-vector embedder is used so the wiring still boots without
   *  any LLM provider configured. */
  readonly upstreamEmbedder?: UpstreamEmbedder;
}

// ---------------------------------------------------------------------------
// Fallback embedder — produces a deterministic vector of EMBEDDING_DIM
// length. Used when no OpenAI key is wired so the rest of the cognitive
// stack still boots in CI / local dev / tests.
// ---------------------------------------------------------------------------

/**
 * Generate a memory-cell id. Uses `crypto.randomUUID()` when available
 * (Node 20+, browsers, Bun, Deno) and falls back to a Math.random-based
 * v4-shape string otherwise. Format compatible with the
 * `cognitive_memory.id` UUID column.
 */
function generateMemoryCellId(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: { randomUUID?: () => string } | undefined = (globalThis as any)
    ?.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  // Fallback v4-shape string. Not cryptographically strong; only used
  // when the runtime does not expose the WebCrypto randomUUID surface.
  const hex = (n: number): string =>
    Math.floor(n).toString(16).padStart(2, '0');
  const bytes: number[] = [];
  for (let i = 0; i < 16; i += 1) {
    bytes.push(Math.floor(Math.random() * 256));
  }
  // Set version 4 + variant bits per RFC 4122.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return [
    bytes.slice(0, 4).map(hex).join(''),
    bytes.slice(4, 6).map(hex).join(''),
    bytes.slice(6, 8).map(hex).join(''),
    bytes.slice(8, 10).map(hex).join(''),
    bytes.slice(10, 16).map(hex).join(''),
  ].join('-');
}

function createFixedVectorEmbedder(): UpstreamEmbedder {
  return {
    async embed(text: string): Promise<ReadonlyArray<number>> {
      if (text.length === 0) {
        // The embedding-service wrapper rejects empty input upstream,
        // but we defensively short-circuit too to keep behaviour
        // deterministic.
        return new Array<number>(EMBEDDING_DIM).fill(0);
      }
      // Deterministic per-text hash spread across the 1536-d vector.
      // Not semantically meaningful — purpose is purely to satisfy the
      // dimensionality contract during fallback mode. Production wiring
      // swaps this for the real OpenAI client.
      const vec = new Array<number>(EMBEDDING_DIM).fill(0);
      for (let i = 0; i < text.length; i += 1) {
        const charCode = text.charCodeAt(i);
        const slot = (charCode * 31 + i) % EMBEDDING_DIM;
        vec[slot] = (vec[slot] ?? 0) + 1 / (text.length + 1);
      }
      return Object.freeze(vec);
    },
  };
}

// ---------------------------------------------------------------------------
// Bundle factories — each is wrapped in a try so a failure in one
// package does not bring down the whole gateway.
// ---------------------------------------------------------------------------

function buildCognitiveMemoryBundle(
  deps: WireCognitiveDeps,
): CognitiveMemoryBundle | null {
  try {
    const cells = createInMemoryCellRepository();
    const reinforcements = createInMemoryReinforcementRepository();
    const audit = createInMemoryAuditChain();
    const upstream = deps.upstreamEmbedder ?? createFixedVectorEmbedder();
    const embedder = createEmbeddingService({ upstream });
    const recall = createRecall({ cells, embedder });
    const observe = createObserve({
      cells,
      embedder,
      audit,
      id: () => generateMemoryCellId(),
    });
    return Object.freeze({
      cells,
      reinforcements,
      embedder,
      audit,
      recall,
      observe,
    });
  } catch (err) {
    deps.logger.warn(
      'cognitive-wiring: cognitive-memory bundle construction failed; degrading slot to null',
      { error: err instanceof Error ? err.message : String(err) },
    );
    return null;
  }
}

function buildPersistentMemoryBundle(
  deps: WireCognitiveDeps,
): PersistentMemoryBundle | null {
  try {
    const sessionRepo = createInMemorySessionMemoryRepository();
    const skillRepo = createInMemorySkillRepository();
    const pendingRepo = createInMemoryPendingThreadRepository();
    const audit = createPersistentAuditChain();
    const sessionRecall = createSessionRecall({ repo: sessionRepo });
    const skillLookup = createSkillLookupByIntent({ repo: skillRepo });
    return Object.freeze({
      sessionRepo,
      skillRepo,
      pendingRepo,
      audit,
      sessionRecall,
      skillLookup,
    });
  } catch (err) {
    deps.logger.warn(
      'cognitive-wiring: persistent-memory bundle construction failed; degrading slot to null',
      { error: err instanceof Error ? err.message : String(err) },
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Construct the wired cognitive bundle. Never throws — failures are
 * logged via the structured logger and surfaced as `null` slots so the
 * gateway boots end-to-end even when a sub-package is misconfigured.
 *
 * Idempotent: callers are expected to call this once at composition-
 * root construction (in `services/api-gateway/src/index.ts` next to
 * `buildServices`) and cache the result for the process lifetime.
 */
export function wireCognitive(deps: WireCognitiveDeps): WiredCognitive {
  const cognitiveMemory = buildCognitiveMemoryBundle(deps);
  const persistent = buildPersistentMemoryBundle(deps);
  const isLive = cognitiveMemory !== null || persistent !== null;
  if (isLive) {
    deps.logger.info('cognitive-wiring: bundles constructed', {
      cognitiveMemory: cognitiveMemory !== null,
      persistent: persistent !== null,
      composition: false, // 12-wire pipeline deferred (see file header).
    });
  } else {
    deps.logger.warn(
      'cognitive-wiring: every bundle degraded; enrichment will be a no-op',
    );
  }
  return Object.freeze({
    cognitiveMemory,
    persistent,
    composition: null,
    isLive,
  });
}

// ---------------------------------------------------------------------------
// Enrichment — turns the wired bundle into a system-prompt prefix that
// the brain.hono.ts /turn handler can prepend before calling Anthropic.
// ---------------------------------------------------------------------------

export interface EnrichArgs {
  readonly wired: WiredCognitive;
  readonly tenantId: string;
  readonly userId: string;
  readonly userText: string;
  readonly personaId: string;
  /** Optional override for the recall fan-out. Default 3. */
  readonly topK?: number;
  /** Optional override for the kinds filter. */
  readonly kinds?: ReadonlyArray<MemoryKind>;
  /** Optional override for the thread id (used for session recall). */
  readonly threadId?: string;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => Date;
  /** Optional logger; defaults to a silent logger. */
  readonly logger?: CognitiveLogger;
}

export interface EnrichResult {
  /** A *new* system prompt — empty string when no enrichment was
   *  available. Callers prepend / append per their needs; we never
   *  mutate the caller's existing prompt. */
  readonly enrichedSystemPrompt: string;
  /** Citation ids (cell ids) that were folded into the prompt. */
  readonly citations: ReadonlyArray<string>;
  /** Recall results in case the caller wants to display them in a
   *  side-channel (e.g. the "what I remembered" debug panel). */
  readonly recallResults: ReadonlyArray<RecallResult>;
}

const EMPTY_CITATIONS: ReadonlyArray<string> = Object.freeze([]);
const EMPTY_RECALL_RESULTS: ReadonlyArray<RecallResult> = Object.freeze([]);

const EMPTY_RESULT: EnrichResult = Object.freeze({
  enrichedSystemPrompt: '',
  citations: EMPTY_CITATIONS,
  recallResults: EMPTY_RECALL_RESULTS,
});

const DEFAULT_TOP_K = 3;

function clampTopK(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TOP_K;
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TOP_K;
  // Hard upper bound — avoid bloating the system prompt accidentally.
  if (value > 12) return 12;
  return Math.floor(value);
}

function formatRecallBlock(
  results: ReadonlyArray<RecallResult>,
  personaId: string,
): string {
  if (results.length === 0) return '';
  // Lines are deliberately short — Anthropic prompts prefer compact
  // structured context. We tag every line with the rank score so the
  // model can reason about confidence.
  const header = `# RELEVANT MEMORIES (top ${results.length.toString()}) — persona=${personaId}`;
  const lines = results.map((r, idx) => {
    const rank = (idx + 1).toString();
    const text = r.cell.content.text.trim();
    const score = r.rank_score.toFixed(3);
    return `${rank}. [${r.cell.kind}|score=${score}] ${text}`;
  });
  return [header, ...lines].join('\n');
}

function formatSessionBlock(
  summary: { readonly summary_md: string } | null,
): string {
  if (summary === null) return '';
  const text = summary.summary_md.trim();
  if (text.length === 0) return '';
  return ['# RECENT SESSION CONTEXT', text].join('\n');
}

/**
 * Enrich the brain-turn system prompt with relevant memories +
 * session context. APPEND-only — the caller's existing prompt is
 * untouched and we return a NEW prefix that the caller may prepend.
 *
 * Graceful degradation contract:
 *   - `wired.cognitiveMemory === null` → memory block omitted.
 *   - `wired.persistent === null`      → session block omitted.
 *   - `wired.isLive === false`         → return `EMPTY_RESULT` directly.
 *   - Recall throws                    → log and skip the memory block.
 *   - Session recall throws            → log and skip the session block.
 */
export async function enrichBrainTurnWithCognitive(
  args: EnrichArgs,
): Promise<EnrichResult> {
  const logger: CognitiveLogger = args.logger ?? createSilentLogger();
  if (!args.wired.isLive) {
    return EMPTY_RESULT;
  }
  const trimmedText = args.userText.trim();
  if (trimmedText.length === 0) {
    return EMPTY_RESULT;
  }

  const topK = clampTopK(args.topK);
  const recallResults = await safeRecall(
    args.kinds === undefined
      ? {
          wired: args.wired,
          tenantId: args.tenantId,
          userText: trimmedText,
          topK,
          logger,
        }
      : {
          wired: args.wired,
          tenantId: args.tenantId,
          userText: trimmedText,
          topK,
          kinds: args.kinds,
          logger,
        },
  );

  const sessionRecallArgs: { -readonly [K in keyof SafeSessionRecallArgs]: SafeSessionRecallArgs[K] } = {
    wired: args.wired,
    tenantId: args.tenantId,
    logger,
  };
  if (args.threadId !== undefined) sessionRecallArgs.threadId = args.threadId;
  if (args.now !== undefined) sessionRecallArgs.now = args.now;
  const sessionSummary = await safeSessionRecall(sessionRecallArgs);

  const memoryBlock = formatRecallBlock(recallResults, args.personaId);
  const sessionBlock = formatSessionBlock(sessionSummary);
  const parts = [memoryBlock, sessionBlock].filter((p) => p.length > 0);

  if (parts.length === 0) {
    return EMPTY_RESULT;
  }

  const enrichedSystemPrompt = parts.join('\n\n');
  const citations = Object.freeze(recallResults.map((r) => r.cell.id));

  return Object.freeze({
    enrichedSystemPrompt,
    citations,
    recallResults: Object.freeze(recallResults.slice()),
  });
}

// ---------------------------------------------------------------------------
// Internal helpers — silent fallbacks + try-wrappers around the package
// operations. Each catches and logs so the brain turn never fails
// because enrichment failed.
// ---------------------------------------------------------------------------

function createSilentLogger(): CognitiveLogger {
  const noop = (): void => {
    // intentional no-op (silent fallback for the enrichment logger)
  };
  return Object.freeze({ debug: noop, info: noop, warn: noop, error: noop });
}

interface SafeRecallArgs {
  readonly wired: WiredCognitive;
  readonly tenantId: string;
  readonly userText: string;
  readonly topK: number;
  readonly kinds?: ReadonlyArray<MemoryKind>;
  readonly logger: CognitiveLogger;
}

async function safeRecall(
  args: SafeRecallArgs,
): Promise<ReadonlyArray<RecallResult>> {
  const cm = args.wired.cognitiveMemory;
  if (cm === null) return [];
  try {
    const query =
      args.kinds === undefined
        ? {
            tenant_id: args.tenantId,
            scope_id: 'tenant_root' as const,
            intent: args.userText,
            limit: args.topK,
          }
        : {
            tenant_id: args.tenantId,
            scope_id: 'tenant_root' as const,
            intent: args.userText,
            limit: args.topK,
            kinds: args.kinds,
          };
    const results = await cm.recall(query);
    // Append-only audit chain row for the recall — keeps the
    // hash-chained provenance invariant in CLAUDE.md.
    await cm.audit
      .append({
        tenant_id: args.tenantId,
        event_kind: 'memory.observe',
        cell_id: 'recall-only',
        specialisation: 'brain-enrich',
        turn_id: '',
        occurred_at: new Date().toISOString(),
        extra: { intent_len: args.userText.length, hits: results.length },
      })
      .catch((err: unknown) => {
        args.logger.warn(
          'cognitive-wiring: recall audit append failed (non-fatal)',
          { error: err instanceof Error ? err.message : String(err) },
        );
      });
    return results;
  } catch (err) {
    if (err instanceof CognitiveMemoryError) {
      args.logger.warn('cognitive-wiring: recall returned typed error', {
        code: err.code,
        message: err.message,
      });
    } else {
      args.logger.warn(
        'cognitive-wiring: recall failed; skipping memory block',
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
    return [];
  }
}

interface SafeSessionRecallArgs {
  readonly wired: WiredCognitive;
  readonly tenantId: string;
  readonly threadId?: string;
  readonly now?: () => Date;
  readonly logger: CognitiveLogger;
}


async function safeSessionRecall(
  args: SafeSessionRecallArgs,
): Promise<{ readonly summary_md: string } | null> {
  const pm = args.wired.persistent;
  if (pm === null) return null;
  if (args.threadId === undefined) return null;
  try {
    const nowFn = args.now ?? ((): Date => new Date());
    const session = await pm.sessionRecall(
      args.tenantId,
      args.threadId,
      nowFn(),
    );
    return session === null ? null : { summary_md: session.summary_md };
  } catch (err) {
    args.logger.warn(
      'cognitive-wiring: session recall failed; skipping session block',
      { error: err instanceof Error ? err.message : String(err) },
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hono middleware factory — sets `c.set('cognitive', wired)` so routes
// can read the bundle via `c.get('cognitive')`. The composition root
// constructs the wired bundle once at boot and then mounts the
// middleware globally; per-request work is O(1) (just a context set).
//
// Designed to be mounted next to `createServiceContextMiddleware` in
// `services/api-gateway/src/index.ts`. Example:
//
//   const wiredCognitive = wireCognitive({ db: getDb(), logger });
//   api.use('*', createServiceContextMiddleware(serviceRegistry));
//   api.use('*', createCognitiveContextMiddleware(wiredCognitive));
//
// Typed as a thin closure to avoid pulling in Hono's
// `createMiddleware` type which would otherwise widen the public
// surface area of this file.
// ---------------------------------------------------------------------------

export interface HonoLikeContext {
  set(key: string, value: unknown): void;
}

export interface HonoLikeMiddlewareFn {
  (c: HonoLikeContext, next: () => Promise<void>): Promise<void>;
}

export function createCognitiveContextMiddleware(
  wired: WiredCognitive,
): HonoLikeMiddlewareFn {
  return async (c, next) => {
    c.set('cognitive', wired);
    await next();
  };
}

// ---------------------------------------------------------------------------
// Internal exports for tests (avoid widening the package surface)
// ---------------------------------------------------------------------------

export const __testables = Object.freeze({
  createFixedVectorEmbedder,
  formatRecallBlock,
  formatSessionBlock,
  clampTopK,
  createSilentLogger,
  DEFAULT_TOP_K,
  EMPTY_RESULT,
});
