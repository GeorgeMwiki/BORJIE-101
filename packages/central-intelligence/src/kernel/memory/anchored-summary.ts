/**
 * Anchored summarisation — condenses earlier turns when the prompt
 * window crosses the configured budget threshold (default 70%).
 *
 * Rationale (per the architect's ADR):
 *
 *   Long-running sessions blow past the model's effective attention
 *   budget. The kernel's default behaviour is to truncate the head of
 *   the message list, losing the entire historical context. Instead,
 *   pause at 70%, summarise the earliest contiguous N turns via an
 *   LLM call, persist the summary in `anchor_summaries`, then re-inject
 *   the summary in place of the truncated turns.
 *
 * Pure orchestration — the LLM call is delegated to an injected
 * `LLMPort`; the persistence is delegated to an `AnchorSummaryRepo`.
 * No direct I/O here.
 */

import type {
  AnchorSummary,
  AnchorSummaryInsert,
  AnchorSummaryRepo,
  LLMPort,
} from './types-amem.js';

/**
 * Budget threshold (fraction of context budget) above which the
 * summariser triggers. Configurable per-call but the default mirrors
 * the ADR.
 */
export const DEFAULT_BUDGET_THRESHOLD = 0.7;

/**
 * Fraction of the in-budget conversation to leave untouched. We keep
 * the most recent 30% verbatim so the agent always has high-fidelity
 * recall of the immediate context; the older 70% is fair game for
 * summarisation.
 */
export const DEFAULT_RETAIN_TAIL_FRACTION = 0.3;

/** Maximum summary tokens budget. */
export const DEFAULT_SUMMARY_MAX_TOKENS = 600;

export interface ConversationTurn {
  readonly turnIdx: number;
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly content: string;
  /** Approximate token count for budget calculations. */
  readonly approxTokens: number;
}

export interface AnchoredSummaryInput {
  readonly tenantId: string | null;
  readonly sessionId: string;
  readonly turns: ReadonlyArray<ConversationTurn>;
  /** Context budget in tokens (e.g. 200_000 for Sonnet 4.5). */
  readonly contextBudgetTokens: number;
  readonly llm: LLMPort;
  readonly repo: AnchorSummaryRepo;
  /** Optional threshold override; default 0.7. */
  readonly budgetThreshold?: number;
  /** Optional tail-retention override; default 0.3. */
  readonly retainTailFraction?: number;
  /** Optional summary maxTokens override; default 600. */
  readonly summaryMaxTokens?: number;
}

export interface AnchoredSummaryResult {
  /** True when the summariser ran (turns were condensed). */
  readonly summarised: boolean;
  /** Persisted summary row when `summarised=true`. */
  readonly summary: AnchorSummary | null;
  /** Tokens saved by replacing the head turns with the summary. */
  readonly tokensSaved: number;
  /** Index range of turns that were summarised (inclusive). */
  readonly summarisedRange: { start: number; end: number } | null;
}

/**
 * If the conversation is over the threshold, summarise the head and
 * persist an `anchor_summaries` row. Returns the persisted summary
 * plus the bookkeeping the caller needs to rewrite the prompt.
 *
 * No-op (returns `summarised=false`) when:
 *   - turns is empty
 *   - total approximate tokens ≤ threshold * budget
 *   - the LLM port throws (fail-soft)
 */
export async function summariseEarlierTurns(
  input: AnchoredSummaryInput,
): Promise<AnchoredSummaryResult> {
  if (!input.llm || typeof input.llm.complete !== 'function') {
    throw new Error('anchored-summary: llm.complete is required');
  }
  if (!input.repo || typeof input.repo.insert !== 'function') {
    throw new Error('anchored-summary: repo.insert is required');
  }
  if (!Array.isArray(input.turns) || input.turns.length === 0) {
    return makeNoop();
  }
  const budget = Math.max(1, Math.floor(input.contextBudgetTokens || 0));
  const threshold = clamp01(
    input.budgetThreshold ?? DEFAULT_BUDGET_THRESHOLD,
  );
  const retainTail = clamp01(
    input.retainTailFraction ?? DEFAULT_RETAIN_TAIL_FRACTION,
  );

  const totalTokens = input.turns.reduce(
    (sum, t) => sum + Math.max(0, Math.floor(t.approxTokens || 0)),
    0,
  );
  if (totalTokens <= threshold * budget) {
    return makeNoop();
  }

  // Walk from oldest forward, accumulating tokens, until we have
  // covered the head (1 - retainTail) of the conversation.
  const headCutoffTokens = Math.floor(totalTokens * (1 - retainTail));
  const headTurns: ConversationTurn[] = [];
  let runningHeadTokens = 0;
  for (const turn of input.turns) {
    if (runningHeadTokens >= headCutoffTokens) break;
    headTurns.push(turn);
    runningHeadTokens += Math.max(0, Math.floor(turn.approxTokens || 0));
  }

  // Require at least two turns to be worth summarising — a single
  // long turn isn't really a "window" and the LLM call wastes spend.
  if (headTurns.length < 2) return makeNoop();

  const startIdx = headTurns[0].turnIdx;
  const endIdx = headTurns[headTurns.length - 1].turnIdx;
  const prompt = buildSummariserPrompt(headTurns);

  let summaryText: string;
  try {
    summaryText = await input.llm.complete({
      prompt,
      maxTokens: input.summaryMaxTokens ?? DEFAULT_SUMMARY_MAX_TOKENS,
      temperature: 0.2,
    });
  } catch {
    // Fail-soft. The caller may retry on a future turn; meanwhile the
    // prompt stays untouched and the model handles a slightly over-
    // budget window (usually fine, since the budget threshold is 70%
    // not 100%).
    return makeNoop();
  }

  const cleaned = (summaryText ?? '').trim();
  if (cleaned.length === 0) return makeNoop();

  const summaryTokens = approxTokenCount(cleaned);
  const tokensSaved = Math.max(0, runningHeadTokens - summaryTokens);

  const insert: AnchorSummaryInsert = {
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    startTurnIdx: startIdx,
    endTurnIdx: endIdx,
    summary: cleaned,
    originalTokens: runningHeadTokens,
    summaryTokens,
    metadata: {
      budgetThreshold: threshold,
      retainTailFraction: retainTail,
      contextBudgetTokens: budget,
    },
  };

  const row = await input.repo.insert(insert);
  return {
    summarised: true,
    summary: row,
    tokensSaved,
    summarisedRange: { start: startIdx, end: endIdx },
  };
}

/**
 * Build the summariser prompt. Self-contained — kept here (not in a
 * separate file) because the format is part of the algorithm: the
 * caller's bookkeeping uses the produced summary text directly as the
 * replacement for the head turns.
 */
export function buildSummariserPrompt(
  turns: ReadonlyArray<ConversationTurn>,
): string {
  const transcript = turns
    .map(
      (t) =>
        `[turn ${t.turnIdx}] ${t.role}: ${truncate(t.content, 4_000)}`,
    )
    .join('\n');
  return [
    'You are condensing the earlier turns of a long-running BORJIE',
    'agent conversation. Goal: preserve every concrete fact, decision,',
    'tool result, and open task. Drop chit-chat. Output 6-12 short bullets.',
    '',
    'Rules:',
    '- KEEP every number, date, currency amount, unit id, lease id, name.',
    '- KEEP every decision the user / agent committed to.',
    '- KEEP every unresolved question or open task.',
    '- DROP greetings, hedges, restated context.',
    '- DROP repeated information; consolidate.',
    '',
    'CONVERSATION TRANSCRIPT:',
    transcript,
    '',
    'CONDENSED BULLETS:',
  ].join('\n');
}

/** Very rough 4-chars-per-token heuristic. Calibrated against tiktoken
 *  on English + Swahili samples in the eval corpus; off by ~10-15%
 *  but acceptable for budget gating where we already pad by 30%. */
export function approxTokenCount(text: string): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

function makeNoop(): AnchoredSummaryResult {
  return {
    summarised: false,
    summary: null,
    tokensSaved: 0,
    summarisedRange: null,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
