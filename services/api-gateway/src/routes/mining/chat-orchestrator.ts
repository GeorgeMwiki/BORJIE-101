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
import { createLogger } from '../../utils/logger';

const orchestratorLogger = createLogger('chat-orchestrator-conformal');

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
  const retrievedContext = tokeniseRetrievedContext(corpusChunks);

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
