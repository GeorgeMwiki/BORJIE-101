/**
 * Chat orchestrator — bridges the `/api/v1/mining/chat` SSE route to the
 * Master Brain junior and the broader Borjie junior pool.
 *
 * Two paths:
 *
 *   1. ANTHROPIC_API_KEY present → call the real `master-brain` junior
 *      via `createDefaultMasterBrainAgent().processInput(...)`. The
 *      Master Brain returns a `dispatch_plan` of juniors that WOULD be
 *      invoked for the query; this orchestrator surfaces each plan
 *      entry as a `junior_call` SSE event and then streams the
 *      `one_line_answer` as a single `message_chunk`. (Executing every
 *      junior in the plan is out of scope for this entry surface — each
 *      junior owns its own resource route.)
 *
 *   2. ANTHROPIC_API_KEY absent → graceful degradation. Pick a static
 *      junior set from the keyword-routing table below, query the global
 *      `intelligence_corpus_chunks` table for the chunk most relevant to
 *      the user message (ILIKE keyword match), and synthesise a
 *      deterministic answer that still carries real `evidence_ids` from
 *      the corpus row. Lets the owner-web demo work end-to-end without
 *      LLM costs.
 *
 * The route file consumes `runChatOrchestrator(...)` as an async
 * generator that yields wire-format SSE events.
 */

import { createDefaultMasterBrainAgent } from '@borjie/ai-copilot';
import { findCorpusEvidence, type CorpusEvidence } from './chat-corpus-evidence';

// ─────────────────────────────────────────────────────────────────────
// Mode → junior routing table (owner-web mode switcher)
// ─────────────────────────────────────────────────────────────────────

/**
 * Owner-facing modes the chat surface accepts. These are the labels the
 * owner-web mode switcher binds against — distinct from the
 * `MasterBrainMode` (which is the Master Brain's internal mode taxonomy
 * — daily_brief / ask / crisis / remediation / planning / compliance /
 * sales).
 *
 * Mapping to internal MasterBrainMode happens in `toMasterBrainMode`.
 */
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
 * Static fallback dispatch — used when ANTHROPIC_API_KEY is unset so the
 * client still gets junior-call breadcrumbs in the SSE stream. The
 * "intent" string is the same shape Master Brain emits.
 *
 * Notes on substitutions:
 *   - `capacity-expansion-advisor` is referenced in the routing spec but
 *     does NOT exist in the Borjie junior pool — the closest available
 *     specialist is `forecast-modeler` (scenario / capacity forecasts),
 *     so strategy mode routes there.
 *   - `document` mode reuses `document-agent` (the PDF / doc-chat
 *     specialist).
 */
const MODE_JUNIORS: Record<ChatMode, ReadonlyArray<{ junior: string; intent: string }>> = {
  build: [
    { junior: 'master-brain', intent: 'Greenfield Q&A grounded in the global Borjie corpus.' },
  ],
  strategy: [
    { junior: 'master-brain', intent: 'Frame the strategic question against the LMBM.' },
    { junior: 'forecast-modeler', intent: 'Project capacity / production / cash scenarios.' },
  ],
  operations: [
    { junior: 'operations-sic-agent', intent: 'Short-Interval-Control deviation analysis.' },
    { junior: 'safety-agent', intent: 'Surface any safety-critical control breaches.' },
  ],
  document: [
    { junior: 'document-agent', intent: 'Read the cited document and answer from its text.' },
  ],
  finance: [
    { junior: 'cost-engineer', intent: 'Unit economics + break-even check.' },
    { junior: 'fx-treasury-agent', intent: 'FX exposure, runway, sell-vs-stockpile.' },
  ],
  risk: [
    { junior: 'risk-modeler', intent: 'Composite risk score across categories.' },
    { junior: 'safety-agent', intent: 'Safety-critical risk overlay.' },
  ],
  'board-investor': [
    { junior: 'report-writer', intent: 'Board-pack / investor-update narrative.' },
  ],
  compliance: [
    { junior: 'compliance-agent', intent: 'Regulator citation lookup against the corpus.' },
    {
      junior: 'contract-currency-auditor',
      intent: 'Flag USD-denominated TZ contracts post-27-Mar-2026 cliff.',
    },
  ],
};

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

export type ChatSseEvent =
  | { readonly type: 'turn_accepted'; readonly mode: ChatMode; readonly language: 'sw' | 'en' }
  | { readonly type: 'junior_call'; readonly junior: string; readonly intent: string }
  | {
      readonly type: 'message_chunk';
      readonly text: string;
      readonly evidence_ids: ReadonlyArray<string>;
      readonly confidence: number;
    }
  | { readonly type: 'done' }
  | { readonly type: 'error'; readonly message: string };

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
 *
 * Flow:
 *   1. `turn_accepted` so the client renders the affordance.
 *   2. Resolve corpus evidence (always — even with API key present, we
 *      surface a citation so the UI panel has something to render).
 *   3. If ANTHROPIC_API_KEY: invoke Master Brain, surface its
 *      `dispatch_plan` as `junior_call` events, then yield its
 *      `one_line_answer` as the message chunk.
 *   4. Else: walk the static `MODE_JUNIORS` table for `junior_call`
 *      events, then yield a corpus-grounded mock message chunk.
 *   5. `done`.
 */
export async function* runChatOrchestrator(
  input: OrchestratorInput,
): AsyncGenerator<ChatSseEvent, void, unknown> {
  yield { type: 'turn_accepted', mode: input.mode, language: input.language };

  const evidence = await findCorpusEvidence({
    db: input.db,
    tenantId: input.tenantId,
    message: input.message,
  });

  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  if (hasApiKey) {
    try {
      const masterBrain = createDefaultMasterBrainAgent();
      const out = await masterBrain.processInput({
        tenantId: input.tenantId,
        mode: toMasterBrainMode(input.mode),
        query: input.message,
        language: input.language === 'sw' ? 'sw' : 'en',
        context: { sessionId: input.sessionId ?? null, ownerMode: input.mode },
      });
      for (const step of out.dispatch_plan) {
        yield { type: 'junior_call', junior: step.junior, intent: step.intent };
      }
      const mergedEvidence = mergeEvidence(out.evidence_ids, evidence);
      yield {
        type: 'message_chunk',
        text: out.one_line_answer,
        evidence_ids: mergedEvidence,
        confidence: out.confidence,
      };
      yield { type: 'done' };
      return;
    } catch (err) {
      // Master Brain failure — surface the soft-error then fall through
      // to the mock path so the client still gets a usable response.
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message: `master_brain_failed: ${message}` };
    }
  }

  // Mock / degraded path.
  for (const step of MODE_JUNIORS[input.mode]) {
    yield { type: 'junior_call', junior: step.junior, intent: step.intent };
  }
  const text = synthesiseMockAnswer({
    mode: input.mode,
    message: input.message,
    evidence,
  });
  yield {
    type: 'message_chunk',
    text,
    evidence_ids: evidence ? [evidence.id] : [],
    confidence: evidence ? 0.55 : 0.4,
  };
  yield { type: 'done' };
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

function mergeEvidence(
  fromBrain: ReadonlyArray<string>,
  fromCorpus: CorpusEvidence | null,
): ReadonlyArray<string> {
  const seen = new Set<string>(fromBrain);
  if (fromCorpus) seen.add(fromCorpus.id);
  return Array.from(seen);
}

function synthesiseMockAnswer(args: {
  readonly mode: ChatMode;
  readonly message: string;
  readonly evidence: CorpusEvidence | null;
}): string {
  if (args.evidence) {
    const excerpt = args.evidence.text.slice(0, 600).replace(/\s+/g, ' ').trim();
    return [
      `[${args.mode}] mock-answer from corpus chunk ${args.evidence.sourceFile}:`,
      excerpt,
    ].join('\n\n');
  }
  return `[${args.mode}] no LLM key and no corpus match for: ${args.message.slice(0, 200)}`;
}
