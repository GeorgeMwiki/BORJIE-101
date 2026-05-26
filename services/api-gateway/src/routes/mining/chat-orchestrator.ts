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
  createDefaultMasterBrainAgent,
  executeJuniors,
  lazyClaudeClient,
  type DispatchPlanStep,
  type JuniorExecutionResult,
} from '@borjie/ai-copilot';
import { findCorpusEvidence, type CorpusEvidence } from './chat-corpus-evidence';

// ─────────────────────────────────────────────────────────────────────
// Owner-facing modes the chat surface accepts
// ─────────────────────────────────────────────────────────────────────

export type ChatMode =
  | 'build'
  | 'strategy'
  | 'operations'
  | 'document'
  | 'finance'
  | 'risk'
  | 'board-investor'
  | 'compliance';

/**
 * Map an owner-facing ChatMode to a Master Brain internal mode. The
 * Master Brain's prompt is keyed on its own enum, so we project the
 * owner mode down to the closest internal label.
 */
function toMasterBrainMode(
  mode: ChatMode,
): 'ask' | 'planning' | 'compliance' | 'remediation' | 'sales' {
  switch (mode) {
    case 'strategy':
    case 'build':
      return 'planning';
    case 'operations':
    case 'risk':
      return 'ask';
    case 'finance':
      return 'sales';
    case 'document':
    case 'board-investor':
      return 'ask';
    case 'compliance':
      return 'compliance';
  }
}

// ─────────────────────────────────────────────────────────────────────
// SSE event union — what the route streams
// ─────────────────────────────────────────────────────────────────────

export type JuniorCallStatus = 'running' | 'done' | 'error';

export type ChatSseEvent =
  | { readonly type: 'turn_accepted'; readonly mode: ChatMode; readonly language: 'sw' | 'en' }
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
  readonly mode: ChatMode;
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
  yield { type: 'turn_accepted', mode: input.mode, language: input.language };

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

  const corpus = await findCorpusEvidence({
    db: input.db,
    tenantId: input.tenantId,
    message: input.message,
  });

  // ── Master Brain ─────────────────────────────────────────────────
  let brainOut;
  try {
    const masterBrain = createDefaultMasterBrainAgent();
    brainOut = await masterBrain.processInput({
      tenantId: input.tenantId,
      mode: toMasterBrainMode(input.mode),
      query: input.message,
      language: input.language === 'sw' ? 'sw' : 'en',
      context: { sessionId: input.sessionId ?? null, ownerMode: input.mode },
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
      mode: input.mode,
      lmbm_context: { sessionId: input.sessionId ?? null, ownerMode: input.mode },
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
  const merged = mergeAllEvidence(brainOut.evidence_ids, results, corpus);
  yield {
    type: 'message_chunk',
    text: brainOut.one_line_answer,
    evidence_ids: merged,
    confidence: brainOut.confidence,
  };
  yield { type: 'done' };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function mergeAllEvidence(
  fromBrain: ReadonlyArray<string>,
  fromJuniors: ReadonlyArray<JuniorExecutionResult>,
  fromCorpus: CorpusEvidence | null,
): ReadonlyArray<string> {
  const seen = new Set<string>(fromBrain);
  for (const r of fromJuniors) {
    for (const id of r.evidence_ids) seen.add(id);
  }
  if (fromCorpus) seen.add(fromCorpus.id);
  return Array.from(seen);
}
