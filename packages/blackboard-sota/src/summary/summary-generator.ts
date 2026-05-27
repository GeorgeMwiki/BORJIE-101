/**
 * Summary generator — token-budgeted multi-pass summarisation.
 *
 * Wave BLACKBOARD-CORE. For a region's posts, produce a single
 * `Summary` row sized to the requested `summary_kind`'s token budget.
 * Multi-pass to keep the prompt under the chunk window (spec §8):
 *
 *   1. Chunk posts into ~2000-token windows.
 *   2. Summarise each window via the injected `SummaryLLMPort`.
 *   3. Concatenate; if total exceeds budget, recursively summarise
 *      again until the budget is met or we run out of recursion.
 *
 * The LLM port is injected (`SummaryLLMPort`) — tests use a
 * deterministic fixture (`__fixtures__/summary-llm.ts`); production
 * wires Claude / Gemini through brain-llm-router.
 *
 * Spec: Docs/DESIGN/BLACKBOARD_SOTA_2026.md §8.
 */

import {
  BLACKBOARD_CONSTANTS,
  type AppendSummaryInput,
  type Post,
  type SummaryKind,
} from '../types.js';

export interface SummaryLLMRequest {
  readonly chunks: ReadonlyArray<string>;
  readonly targetTokens: number;
  /** The region kind — passed to the LLM as a system-prompt hint. */
  readonly regionKind?: string;
}

export interface SummaryLLMResponse {
  readonly text: string;
  readonly tokenCount: number;
}

export interface SummaryLLMPort {
  summarise(req: SummaryLLMRequest): Promise<SummaryLLMResponse>;
}

export interface SummaryGeneratorDeps {
  readonly llm: SummaryLLMPort;
  /** Override token budgets — defaults to BLACKBOARD_CONSTANTS. */
  readonly tokenBudgets?: Partial<Record<SummaryKind, number>>;
  /** Override chunk window — defaults to SUMMARY_CHUNK_TOKEN_BUDGET. */
  readonly chunkTokenBudget?: number;
  /** Maximum number of summarisation passes — guards against runaway. */
  readonly maxPasses?: number;
}

export interface SummaryGenerator {
  generate(args: {
    readonly tenantId: string;
    readonly regionId: string;
    readonly summaryKind: SummaryKind;
    readonly posts: ReadonlyArray<Post>;
    readonly coversFrom: Date;
    readonly coversTo: Date;
    readonly regionKindHint?: string;
  }): Promise<AppendSummaryInput>;
}

/**
 * Naive token estimator — ~4 chars per token, which is close enough
 * for English-language ops text. Production wires a real tokenizer
 * via the brain-llm-router cost engine; that path is opt-in.
 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

const DEFAULT_TOKEN_BUDGETS: Record<SummaryKind, number> = {
  rolling: BLACKBOARD_CONSTANTS.ROLLING_SUMMARY_TOKEN_BUDGET,
  final: BLACKBOARD_CONSTANTS.FINAL_SUMMARY_TOKEN_BUDGET,
  digest: BLACKBOARD_CONSTANTS.DIGEST_SUMMARY_TOKEN_BUDGET,
};

export function createSummaryGenerator(
  deps: SummaryGeneratorDeps,
): SummaryGenerator {
  const { llm } = deps;
  const tokenBudgets: Record<SummaryKind, number> = {
    ...DEFAULT_TOKEN_BUDGETS,
    ...(deps.tokenBudgets ?? {}),
  };
  const chunkBudget =
    deps.chunkTokenBudget ?? BLACKBOARD_CONSTANTS.SUMMARY_CHUNK_TOKEN_BUDGET;
  const maxPasses = deps.maxPasses ?? 3;

  return {
    async generate(args) {
      const budget = tokenBudgets[args.summaryKind];
      const formatted = args.posts.map(formatPostForSummary);
      const chunks = chunkByTokenBudget(formatted, chunkBudget);

      let currentChunks: ReadonlyArray<string> = chunks;
      let result: SummaryLLMResponse = { text: '', tokenCount: 0 };

      for (let pass = 0; pass < maxPasses; pass += 1) {
        const targetTokens = pass === 0 ? budget : Math.min(budget, 800);
        const req: SummaryLLMRequest = args.regionKindHint !== undefined
          ? {
              chunks: currentChunks,
              targetTokens,
              regionKind: args.regionKindHint,
            }
          : { chunks: currentChunks, targetTokens };
        result = await llm.summarise(req);
        if (result.tokenCount <= budget) break;
        // Over budget — re-chunk and run again.
        currentChunks = chunkByTokenBudget([result.text], chunkBudget);
      }

      // Final hard-clamp so the persisted token_count never exceeds
      // the declared budget; this protects the per-region audit-chain
      // economics from a misbehaving LLM port.
      const tokenCount = Math.min(result.tokenCount, budget);

      return {
        tenantId: args.tenantId,
        regionId: args.regionId,
        summaryKind: args.summaryKind,
        summaryText: result.text,
        tokenCount,
        coversFrom: args.coversFrom,
        coversTo: args.coversTo,
      };
    },
  };
}

function formatPostForSummary(post: Post): string {
  // Compact one-line-ish format: `[posted_at] ks_id :: content`.
  const ts = post.postedAt.toISOString();
  return `[${ts}] ${post.ksId} :: ${post.content}`;
}

function chunkByTokenBudget(
  items: ReadonlyArray<string>,
  chunkTokenBudget: number,
): ReadonlyArray<string> {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  for (const item of items) {
    const itemTokens = estimateTokens(item);
    if (currentTokens + itemTokens > chunkTokenBudget && current.length > 0) {
      chunks.push(current.join('\n'));
      current = [];
      currentTokens = 0;
    }
    current.push(item);
    currentTokens += itemTokens;
  }
  if (current.length > 0) chunks.push(current.join('\n'));
  if (chunks.length === 0) chunks.push('');
  return chunks;
}
