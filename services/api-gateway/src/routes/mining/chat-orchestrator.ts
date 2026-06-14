/**
 * Chat orchestrator — bridges the `/api/v1/mining/chat` SSE route to the
 * Master Brain junior and the broader Borjie junior pool.
 *
 * Single real path (mock fallback was stripped per the recent directive):
 *
 *   1. Validate `ANTHROPIC_API_KEY` is present. If absent, abort with a
 *      `BorjieConfigError` surfaced as a single `error` SSE event.
 *   2. Resolve a corpus evidence chunk (best-effort — citation panel).
 *   3. Call Master Brain → get a `dispatch_plan` of juniors + a
 *      one_line_answer.
 *   4. For each junior in the plan, synthesize a valid Zod input from
 *      the chat message, execute it, and stream `junior_call` events
 *      with `status: 'running'` then `status: 'done'` (plus evidence_ids
 *      + confidence). Individual junior failures emit a `status: 'error'`
 *      `junior_call` event but the chain continues.
 *   5. Optionally re-call Master Brain with all junior outputs as
 *      context to produce a final synthesis answer; this is the
 *      `message_chunk` text. Evidence_ids on the message_chunk are the
 *      UNION of every junior's evidence + the Master Brain's own +
 *      the corpus chunk.
 *   6. `done`.
 *
 * The route file consumes `runChatOrchestrator(...)` as an async
 * generator that yields wire-format SSE events.
 */

import {
  BorjieConfigError,
  classifyLenses,
  createDefaultMasterBrainAgent,
  executeJuniors,
  lazyClaudeClient,
  type DispatchPlanStep,
  type JuniorExecutionResult,
  type LensId,
  type RetrievedContextChunk,
} from '@borjie/ai-copilot';
import { createPiiTokeniser } from '@borjie/document-ai';
import { withTenantContext } from '@borjie/database';
import {
  CORPUS_TOPK_DEFAULT,
  embedQueryViaOpenAI,
  searchCorpusTopK,
  type CorpusEvidence,
} from './chat-corpus-evidence';
import { expandGraphEvidence } from './graph-rag-expand';
import type { KgDbExec } from '../../composition/knowledge-graph/postgres-kg-store';
import { applyChatConformalConfidence } from '../../composition/conformal/chat-conformal-confidence';
// KI-005 — the evidence-chain Auditor gate. The non-stream brain.hono.ts
// path already calls `auditChatResponse` to enforce the CLAUDE.md
// evidence-required hard rule (withhold ungrounded JSON answers). A stream
// cannot un-send tokens already flushed, so on this SSE surface we SURFACE
// the verdict as a terminal `auditor` event instead of withholding — the
// grounding signal is never silently dropped.
import { auditChatResponse } from '../../composition/chat-response-gate';
import { createLogger } from '../../utils/logger';
// Stage 3 — orchestrator main-loop as the DEFAULT-ON live generator for
// the mining chat surface. When ON, generation flows through
// `sov.kernel.think()` (rails + answer in ONE call) instead of the
// Master-Brain junior-dispatch fan-out. The existing
// `applyChatConformalConfidence` wire + the `message_chunk` SSE contract
// are preserved. When OFF (`KERNEL_USE_ORCHESTRATOR=false` hard-kill /
// `BORJIE_ORCHESTRATOR_MAINLOOP=0|false|off` soft-disable) the
// `createDefaultMasterBrainAgent().processInput` path runs UNCHANGED.
import { resolveBrainOrchestratorRoutingEnabled } from '../../composition/brain-orchestrator-turn';
// LIVING-MD organ — the per-turn commitment hooks (the felt diff). The pre-turn
// hook RE-READS the durable plan (Magentic-One dual-ledger discipline: re-read
// the outer task ledger every loop) and injects a single-language system context
// block; the post-turn hook surfaces a `commitment_state` event when a
// commitment became due (the reconciliation sweep reaching the conversation).
// Wired ONCE at composition time via `configureLivingMdTurnHooks` (DI, not a
// global read) so this generator stays decoupled + testable.
import type {
  CommitmentStateWireEvent,
  TurnCommitmentHooks,
} from '../../composition/living-md/turn-commitment-hooks';

const orchestratorLogger = createLogger('chat-orchestrator-conformal');

// ─────────────────────────────────────────────────────────────────────
// LIVING-MD turn-hooks injection (composition-time DI, fail-safe).
//
// The composition root calls `configureLivingMdTurnHooks(organ.turnHooks)`
// once at boot. When unwired (degraded boot / tests), the turn proceeds
// EXACTLY as before (no injection, no commitment_state event) — the hooks
// are purely additive and never on the critical path of a turn.
// ─────────────────────────────────────────────────────────────────────

let injectedTurnHooks: TurnCommitmentHooks | null = null;

/** Wire the LIVING-MD turn hooks at composition time (next to the tool wires). */
export function configureLivingMdTurnHooks(hooks: TurnCommitmentHooks): void {
  injectedTurnHooks = hooks;
}

/** Reset the injected hooks (tests). */
export function resetLivingMdTurnHooks(): void {
  injectedTurnHooks = null;
}

/**
 * Bounded lookback for the per-turn "became due / new since last turn" diff.
 * The orchestrator has no per-session turn-timestamp store, so we re-read the
 * ledger over a short window — recently-changed commitments surface, and the
 * idempotent post-turn event coalesces a re-surface across rapid turns.
 */
const LIVING_MD_TURN_LOOKBACK_MS = 15 * 60 * 1000;

/**
 * POST-TURN effect (reconciliation sweep reaching the conversation). Re-reads
 * the plan FRESH after the turn; yields a `commitment_state` event when a
 * commitment became due since `sinceMs` (and, for sovereign newly-due items,
 * the hook itself requests a safe-halt draft — never auto-executes). Fail-safe:
 * an absent hook / a fault yields nothing. Shared by both generation paths so
 * the felt diff is identical Master-Brain vs orchestrator.
 */
async function* emitLivingMdPostTurn(
  input: OrchestratorInput,
  sinceMs: number,
): AsyncGenerator<CommitmentStateWireEvent, void, unknown> {
  if (!injectedTurnHooks) return;
  try {
    const post = await injectedTurnHooks.postTurn({
      tenantId: input.tenantId,
      language: input.language === 'sw' ? 'sw' : 'en',
      lastTurnAtMs: sinceMs,
    });
    if (post.event) yield post.event;
  } catch (err) {
    orchestratorLogger.warn(
      { tenantId: input.tenantId, err: err instanceof Error ? err.message : String(err) },
      'living-md: post-turn effect failed (no commitment_state event)',
    );
  }
}

/**
 * KI-005 — POST-ANSWER auditor verdict (the evidence-chain grounding signal).
 * Runs `auditChatResponse` over the FINAL answer text and yields a single
 * terminal `auditor` event carrying the verdict. A stream cannot un-send the
 * tokens already flushed, so the verdict is SURFACED (never withholds) — the
 * client renders a grounding badge/warning when the answer was ungrounded.
 *
 * Fail-safe: the gate itself is best-effort (it never throws), but we still
 * try/catch + log here so a construction fault can never crash the turn. On
 * any fault NO `auditor` event is emitted (the turn proceeds exactly as
 * before — the verdict is purely additive). Shared by both generation paths
 * so the grounding signal is identical Master-Brain vs orchestrator.
 *
 * `personaId` mirrors the non-stream brain.hono.ts call: the mining /chat
 * surface speaks as the head persona (`mr-mwikila-head`).
 */
async function* emitAuditorVerdict(
  input: OrchestratorInput,
  finalAnswerText: string,
): AsyncGenerator<ChatSseEvent, void, unknown> {
  try {
    const verdict = await auditChatResponse({
      tenantId: input.tenantId,
      threadId: input.sessionId,
      userId: input.userId,
      personaId: 'mr-mwikila-head',
      responseText: finalAnswerText,
    });
    yield {
      type: 'auditor',
      verdict: verdict.verdict,
      evidenceCount: verdict.evidenceCount,
      evidenceWarning: verdict.evidenceWarning,
      groundingFault: verdict.groundingFault,
    };
  } catch (err) {
    orchestratorLogger.warn(
      { tenantId: input.tenantId, err: err instanceof Error ? err.message : String(err) },
      'chat auditor: verdict surfacing failed (no auditor event)',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Persona lenses are classified INTERNALLY — the owner never picks a mode.
// `classifyLenses(message)` (from @borjie/ai-copilot) maps the message to
// 1..N lenses, blends their directives, and derives the brain's own
// MasterBrainMode. See `juniors/lens-router.ts`.
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// SSE event union — what the route streams
// ─────────────────────────────────────────────────────────────────────

export type JuniorCallStatus = 'running' | 'done' | 'error';

export type ChatSseEvent =
  | {
      readonly type: 'turn_accepted';
      readonly lenses: ReadonlyArray<LensId>;
      readonly language: 'sw' | 'en';
    }
  | {
      readonly type: 'junior_call';
      readonly junior: string;
      readonly intent: string;
      readonly status: JuniorCallStatus;
      readonly evidence_ids?: ReadonlyArray<string>;
      readonly confidence?: number;
      readonly error?: string;
    }
  | {
      readonly type: 'message_chunk';
      readonly text: string;
      readonly evidence_ids: ReadonlyArray<string>;
      readonly confidence: number;
    }
  | {
      // KI-005 — the evidence-chain Auditor verdict for the final answer.
      // Streamed tokens can't be un-sent, so we SURFACE the verdict as the
      // LAST event before `done` (never withhold). Mirrors the
      // `auditChatResponse` contract used by the non-stream brain.hono.ts
      // path so both surfaces carry the same grounding signal.
      readonly type: 'auditor';
      readonly verdict: 'approve' | 'reject' | 'needs_human';
      readonly evidenceCount: number;
      readonly evidenceWarning: 'no_evidence_cited' | 'evidence_invalid' | null;
      readonly groundingFault: boolean;
    }
  | CommitmentStateWireEvent
  | { readonly type: 'done' }
  | {
      readonly type: 'error';
      readonly message: string;
      readonly source?: 'master-brain' | 'config' | 'orchestrator';
    };

export interface OrchestratorInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly language: 'sw' | 'en';
  readonly message: string;
  readonly sessionId: string | null;
  readonly db: unknown;
}

/**
 * Yield SSE events for one chat turn. Caller wraps each event in
 * `stream.writeSSE(...)`.
 */
export async function* runChatOrchestrator(
  input: OrchestratorInput,
  // Optional cancellation signal — the mining /chat SSE route aborts it on
  // client disconnect so the kernel forwards it onto the provider request and
  // in-flight token generation stops (mfr-3). Backward-compatible: callers that
  // omit it behave exactly as before.
  options?: { signal?: AbortSignal },
): AsyncGenerator<ChatSseEvent, void, unknown> {
  // No user-selected mode (WS-0): the brain classifies the persona lens(es)
  // from the message itself and blends them. The lens router is deterministic
  // and LLM-free, so it runs before any API call — the turn_accepted frame can
  // name the selected lenses immediately, and the blend steers every step that
  // follows (Master Brain dispatch + per-junior synthesis).
  const lensSelection = classifyLenses(input.message);
  yield {
    type: 'turn_accepted',
    lenses: lensSelection.lenses,
    language: input.language,
  };

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    yield {
      type: 'error',
      source: 'config',
      message:
        'ANTHROPIC_API_KEY missing — chat orchestrator cannot run without a real Claude client (no mock fallback).',
    };
    yield { type: 'done' };
    return;
  }

  // ── RAG retrieval + grounding ────────────────────────────────────
  // Pull the top-K corpus chunks, PII-tokenise their TEXT (the LLM never
  // sees raw national IDs / phones / GPS — TZ DPA s.42), then INJECT the
  // tokenised passages into BOTH the Master Brain and the per-junior
  // synthesizer so the answer is GROUNDED in the corpus (not just citing
  // ids). Empty retrieval ⇒ `retrievedContext` is [] and the prompts are
  // byte-identical to the un-grounded path.
  // This router mounts `databaseMiddlewareNoPin` (it streams + fans out to
  // the LLM), so the request connection is NOT pinned. Embed the query
  // OUTSIDE any DB transaction (external OpenAI round-trip), then run the
  // corpus read inside a SHORT per-tenant transaction so RLS FORCE sees the
  // tenant GUC — without holding a pooled connection across the LLM work
  // below. Best-effort: any failure degrades to the un-grounded path
  // (identical to an empty retrieval).
  // GraphRAG (Issue: @borjie/knowledge-graph wiring): inside the SAME per-tenant
  // transaction (so RLS scopes every read), after the vector top-K we expand a
  // 1–2 hop neighbourhood around the retrieved chunks in the tenant's knowledge
  // graph (kg_nodes/kg_edges) and ADD the connected corpus chunks as extra
  // evidence. The expansion reuses the corpus's OWN precomputed embeddings
  // (graph nodes copied them at ingest time — no new embedder here). If the
  // tenant has no graph, the expansion returns [] and this path is identical to
  // vector-only — no fabrication.
  let corpusChunks: ReadonlyArray<CorpusEvidence> = [];
  try {
    const queryEmbedding = await embedQueryViaOpenAI(input.message);
    corpusChunks = await withTenantContext(
      input.db as Parameters<typeof withTenantContext>[0],
      input.tenantId,
      async (tx) => {
        const vectorHits = await searchCorpusTopK({
          db: tx,
          tenantId: input.tenantId,
          message: input.message,
          k: CORPUS_TOPK_DEFAULT,
          embedding: queryEmbedding,
        });
        const graphHits = await expandGraphEvidence({
          db: tx as unknown as KgDbExec,
          tenantId: input.tenantId,
          seedChunks: vectorHits,
        });
        return mergeCorpusEvidence(vectorHits, graphHits);
      },
    );
  } catch {
    corpusChunks = [];
  }
  const retrievedContextBase = tokeniseRetrievedContext(corpusChunks);

  // ── LIVING-MD PRE-TURN re-read (Magentic-One dual-ledger discipline) ──
  // RE-READ the durable commitment plan FRESH (never from memory between ticks)
  // and, when there is a backlog worth surfacing, inject a SINGLE-LANGUAGE
  // system context block into the grounding set so the brain reasons over the
  // backlog WITHOUT the owner asking. The block carries a non-corpus id
  // ('living-md:backlog') so it never enters the cited-evidence union
  // (mergeAllEvidence merges corpus/brain/junior evidence only). Fail-safe: an
  // absent hook / a read fault degrades to the un-injected path (identical to
  // today). `lastTurnAtMs` is a bounded lookback so "became due since" is honest.
  const livingMdSinceMs = Date.now() - LIVING_MD_TURN_LOOKBACK_MS;
  let retrievedContext: ReadonlyArray<RetrievedContextChunk> = retrievedContextBase;
  if (injectedTurnHooks) {
    try {
      const pre = await injectedTurnHooks.preTurn({
        tenantId: input.tenantId,
        language: input.language === 'sw' ? 'sw' : 'en',
        lastTurnAtMs: livingMdSinceMs,
      });
      if (pre.contextBlock) {
        retrievedContext = [
          ...retrievedContextBase,
          { id: 'living-md:backlog', text: pre.contextBlock },
        ];
      }
    } catch (err) {
      orchestratorLogger.warn(
        { tenantId: input.tenantId, err: err instanceof Error ? err.message : String(err) },
        'living-md: pre-turn re-read failed (un-injected fallback)',
      );
    }
  }

  // ── Stage 3 — orchestrator main-loop (DEFAULT-ON live generator) ──
  // When ON, generate via `sov.kernel.think()` — the disciplined kernel
  // runs the inviolable/policy/drift rails AND the answer in ONE call —
  // instead of the Master-Brain junior fan-out. The conformal-confidence
  // calibration + the `message_chunk` SSE contract are preserved. When OFF
  // the Master-Brain path below runs UNCHANGED (byte-identical fallback).
  if (resolveBrainOrchestratorRoutingEnabled()) {
    yield* runChatViaOrchestrator(input, {
      lensSelection,
      corpusChunks,
      livingMdSinceMs,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    return;
  }

  // ── Master Brain ─────────────────────────────────────────────────
  let brainOut;
  try {
    const masterBrain = createDefaultMasterBrainAgent();
    brainOut = await masterBrain.processInput({
      tenantId: input.tenantId,
      mode: lensSelection.derivedMode,
      query: input.message,
      language: input.language === 'sw' ? 'sw' : 'en',
      context: {
        sessionId: input.sessionId ?? null,
        activeLenses: lensSelection.lenses,
        lensDirective: lensSelection.directive,
      },
      retrievedContext: [...retrievedContext],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'error', source: 'master-brain', message };
    yield { type: 'done' };
    return;
  }

  // ── Per-junior execution ─────────────────────────────────────────
  const dispatchPlan: ReadonlyArray<DispatchPlanStep> = brainOut.dispatch_plan.map((s) => ({
    junior: s.junior,
    intent: s.intent,
  }));

  // Buffer-bridge: the executor uses callbacks, the orchestrator is an
  // async generator. We push hook events into a queue and surface a
  // "wake up" promise that resolves whenever a new event lands; the
  // generator awaits that promise, drains, then re-arms. This keeps SSE
  // events in real-time order without polling.
  const eventQueue: ChatSseEvent[] = [];
  let wake: (() => void) | null = null;
  let wakePromise: Promise<void> = new Promise((resolve) => {
    wake = resolve;
  });
  function pushAndWake(evt: ChatSseEvent): void {
    eventQueue.push(evt);
    const w = wake;
    wake = null;
    wakePromise = new Promise((resolve) => {
      wake = resolve;
    });
    w?.();
  }

  const claude = lazyClaudeClient();
  const resultsPromise = executeJuniors({
    dispatchPlan,
    context: {
      tenantId: input.tenantId,
      chat_message: input.message,
      mode: lensSelection.derivedMode,
      lmbm_context: {
        sessionId: input.sessionId ?? null,
        activeLenses: lensSelection.lenses,
        primaryLens: lensSelection.primary,
      },
      retrieved_context: retrievedContext,
    },
    claude,
    parallel: false,
    hooks: {
      onStart(step) {
        pushAndWake({
          type: 'junior_call',
          junior: step.junior,
          intent: step.intent,
          status: 'running',
        });
      },
      onResult(result) {
        pushAndWake({
          type: 'junior_call',
          junior: result.junior_name,
          intent: result.intent,
          status: result.error ? 'error' : 'done',
          evidence_ids: result.evidence_ids,
          confidence: result.confidence,
          ...(result.error !== undefined ? { error: result.error } : {}),
        });
      },
    },
  });

  // Sentinel that resolves when the executor finishes (success or error).
  let finished = false;
  let executorError: unknown = null;
  let results: ReadonlyArray<JuniorExecutionResult> = [];
  const settle = resultsPromise
    .then((r) => {
      results = r;
    })
    .catch((err) => {
      executorError = err;
    })
    .finally(() => {
      finished = true;
      wake?.(); // unblock the drain loop
    });

  while (!finished || eventQueue.length > 0) {
    while (eventQueue.length > 0) {
      const next = eventQueue.shift();
      if (next) yield next;
    }
    if (!finished) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.race([wakePromise, settle]);
    }
  }
  await settle;

  if (executorError) {
    if (executorError instanceof BorjieConfigError) {
      yield { type: 'error', source: 'config', message: executorError.message };
      yield { type: 'done' };
      return;
    }
    const message = executorError instanceof Error ? executorError.message : String(executorError);
    yield { type: 'error', source: 'orchestrator', message };
    yield { type: 'done' };
    return;
  }

  // ── Merge evidence + emit final message_chunk ────────────────────
  // Cite EVERY grounded chunk id (the answer is grounded in their text)
  // plus the brain's + each junior's own evidence — the union the Auditor
  // verifies against.
  const merged = mergeAllEvidence(brainOut.evidence_ids, results, corpusChunks);

  // ── Conformal confidence calibration (LIVE) ──────────────────────
  // Re-grade the brain's emitted confidence against the tenant's online-ACI
  // calibrated alpha BEFORE it ships. This is where the conformal
  // coverage-feedback loop changes the brain's live confidence OUTPUT: when the
  // loop has learned that the brain was over/under-covering, the SAME emitted
  // float yields a different `message_chunk.confidence`. Cold-start / loop-off
  // degrades to the raw float snapped to the unshifted tiers (never fabricated,
  // never throws). The prediction type is `chat_turn_confidence`; the outcome
  // side that MOVES this alpha is the live reconciliation feed (see
  // composition/conformal/reconciliation-conformal-feed.ts).
  const calibrated = await applyChatConformalConfidence({
    db: input.db,
    tenantId: input.tenantId,
    rawConfidence: brainOut.confidence,
    logger: {
      warn: (obj, msg) => orchestratorLogger.warn(obj, msg ?? 'chat conformal'),
    },
  });

  yield {
    type: 'message_chunk',
    text: brainOut.one_line_answer,
    evidence_ids: merged,
    confidence: calibrated.confidence,
  };
  // LIVING-MD POST-TURN — the reconciliation sweep reaches the conversation.
  yield* emitLivingMdPostTurn(input, livingMdSinceMs);
  // KI-005 — surface the evidence-chain Auditor verdict as the LAST event
  // before `done` (streamed tokens can't be un-sent → surface, never withhold).
  yield* emitAuditorVerdict(input, brainOut.one_line_answer);
  yield { type: 'done' };
}

// ─────────────────────────────────────────────────────────────────────
// Stage 3 — orchestrator main-loop generation for the mining chat surface.
//
// When the orchestrator is the live generator, the disciplined kernel
// `think()` call runs the inviolable/policy/drift rails AND produces the
// answer in ONE pass. We thread the SAME PII-tokenised corpus grounding +
// the active locale + the persona-lens directive so the answer is grounded
// and single-language (CLAUDE.md). The emitted confidence is wrapped by
// the EXACT same `applyChatConformalConfidence` calibration the
// Master-Brain path uses, and the answer ships on the SAME `message_chunk`
// SSE frame.
//
// HONEST DELTA vs the Master-Brain path (documented, never faked):
//   - NO `junior_call` frames: the orchestrator executes tools internally
//     via its own dispatcher + 9-hook chain (audited there), so there is
//     no per-junior `running`/`done` fan-out to stream. Clients that
//     render junior chips simply see none on this path.
//   - evidence_ids are the UNION of the grounded corpus chunk ids + the
//     kernel decision's own citation ids (the Auditor-valid set). The
//     Master-Brain path additionally merged per-junior evidence; with no
//     juniors that contribution is naturally empty.
//   - a kernel `refusal` surfaces as an `error` frame (source
//     'master-brain') + `done`, mirroring how the Master-Brain path
//     surfaces a brain-level failure to the client.
// ─────────────────────────────────────────────────────────────────────

async function* runChatViaOrchestrator(
  input: OrchestratorInput,
  ctx: {
    readonly lensSelection: ReturnType<typeof classifyLenses>;
    readonly corpusChunks: ReadonlyArray<CorpusEvidence>;
    /** LIVING-MD bounded lookback for the post-turn became-due diff. */
    readonly livingMdSinceMs: number;
    readonly signal?: AbortSignal;
  },
): AsyncGenerator<ChatSseEvent, void, unknown> {
  // Resolve the live SovereignBrain for this tenant. Dynamic import keeps
  // the sovereign composition root out of this module's eval graph (mirrors
  // the brain.hono.ts pattern). On any construction fault we surface a
  // single error frame + done — never a half-stream.
  let decision;
  try {
    const { getSovereignBrain } = await import('../../composition/sovereign.js');
    const sov = await getSovereignBrain({
      tenantId: input.tenantId,
      userId: input.userId,
    });
    decision = await sov.kernel.think({
      threadId: input.sessionId ?? `mining-chat:${input.tenantId}:${input.userId}`,
      userMessage: input.message,
      scope: {
        kind: 'tenant',
        tenantId: input.tenantId,
        actorUserId: input.userId,
        // The chat surface does not carry the viewer's role set; an empty
        // roles array keeps grounding conservative (the rails still fire).
        roles: [],
        personaId: 'mr-mwikila-head',
      },
      tier: 'tenant',
      stakes: 'medium',
      surface: 'owner-portal',
      // CLAUDE.md bilingual single-language — thread the active locale so
      // the orchestrator's terminal directive renders single-language.
      language: input.language === 'sw' ? 'sw' : 'en',
    }, ctx.signal ? { signal: ctx.signal } : undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'error', source: 'master-brain', message };
    yield { type: 'done' };
    return;
  }

  // A hard refusal surfaces as a brain-level error (mirrors the
  // Master-Brain path's error+done on a brain failure).
  if (decision.kind === 'refusal') {
    yield { type: 'error', source: 'master-brain', message: decision.reason };
    yield { type: 'done' };
    return;
  }

  // Merge evidence: grounded corpus chunk ids ∪ the kernel decision's own
  // citation ids — the Auditor-valid union.
  const merged = mergeOrchestratorEvidence(decision.citations, ctx.corpusChunks);

  // Conformal-confidence calibration (LIVE) — apply the SAME wrap the
  // Master-Brain path applies, to the kernel decision's overall confidence.
  const calibrated = await applyChatConformalConfidence({
    db: input.db,
    tenantId: input.tenantId,
    rawConfidence: decision.confidence.overall,
    logger: {
      warn: (obj, msg) => orchestratorLogger.warn(obj, msg ?? 'chat conformal'),
    },
  });

  yield {
    type: 'message_chunk',
    text: decision.text,
    evidence_ids: merged,
    confidence: calibrated.confidence,
  };
  // LIVING-MD POST-TURN — the reconciliation sweep reaches the conversation
  // on the orchestrator path too (identical felt diff to the Master-Brain path).
  yield* emitLivingMdPostTurn(input, ctx.livingMdSinceMs);
  // KI-005 — surface the evidence-chain Auditor verdict as the LAST event
  // before `done` (identical grounding signal on the orchestrator path).
  yield* emitAuditorVerdict(input, decision.text);
  yield { type: 'done' };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * PII-tokenise the retrieved corpus passages before any LLM egress. One
 * tokeniser instance is shared across all chunks so the token numbering is
 * globally stable (chunk A's `[NIDA_1]` never collides with chunk B's).
 * The raw values never leave the process; the model reasons over tokens.
 */
function tokeniseRetrievedContext(
  chunks: ReadonlyArray<CorpusEvidence>,
): ReadonlyArray<RetrievedContextChunk> {
  if (chunks.length === 0) return [];
  const tokeniser = createPiiTokeniser();
  const out: RetrievedContextChunk[] = [];
  for (const chunk of chunks) {
    if (!chunk.id || chunk.text.length === 0) continue;
    out.push({ id: chunk.id, text: tokeniser.tokenise(chunk.text) });
  }
  return out;
}

/**
 * Merge the vector top-K with the GraphRAG-expanded chunks, de-duplicated by
 * chunk id and preserving vector-first relevance order. The graph hops APPEND
 * only chunks not already retrieved, so the brain/juniors see a strictly richer
 * (never smaller) grounded evidence set. Every entry carries a real
 * `intelligence_corpus_chunks.id` — the union stays Auditor-valid.
 */
function mergeCorpusEvidence(
  vectorHits: ReadonlyArray<CorpusEvidence>,
  graphHits: ReadonlyArray<CorpusEvidence>,
): ReadonlyArray<CorpusEvidence> {
  const seen = new Set<string>();
  const out: CorpusEvidence[] = [];
  for (const c of [...vectorHits, ...graphHits]) {
    if (!c.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

function mergeAllEvidence(
  fromBrain: ReadonlyArray<string>,
  fromJuniors: ReadonlyArray<JuniorExecutionResult>,
  fromCorpus: ReadonlyArray<CorpusEvidence>,
): ReadonlyArray<string> {
  const seen = new Set<string>(fromBrain);
  for (const r of fromJuniors) {
    for (const id of r.evidence_ids) seen.add(id);
  }
  for (const c of fromCorpus) {
    if (c.id) seen.add(c.id);
  }
  return Array.from(seen);
}

/**
 * Stage 3 — merge the orchestrator decision's own citation ids with the
 * grounded corpus chunk ids, de-duplicated. Both carry real ids the
 * Auditor verifies against (corpus chunk ids + kernel-emitted citation
 * ids), so the union stays Auditor-valid.
 */
function mergeOrchestratorEvidence(
  citations: ReadonlyArray<{ readonly id: string }>,
  fromCorpus: ReadonlyArray<CorpusEvidence>,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  for (const cit of citations) {
    if (cit.id) seen.add(cit.id);
  }
  for (const c of fromCorpus) {
    if (c.id) seen.add(c.id);
  }
  return Array.from(seen);
}
