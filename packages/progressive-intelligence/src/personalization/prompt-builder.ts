/**
 * Per-user few-shot prompt augmentation.
 *
 * `buildPersonalizedPrompt({...})`:
 *  1. Selects up to `k` examples whose embeddings are most similar to
 *     `queryEmbedding` (cosine).
 *  2. Optionally truncates each example to fit a token budget. The
 *     budget is a soft cap — we trim examples one at a time from the
 *     bottom until we fit, never dropping the basePrompt.
 *  3. Returns the assembled prompt as a single string.
 *
 * Pure. Token counting uses an injectable counter (default = whitespace
 * heuristic — 0.75 tokens per char per OpenAI rule-of-thumb). For
 * production accuracy, callers can inject a real BPE tokenizer.
 */
import { cosineSimilarity } from '../entity-resolution/scoring.js';
import type {
  PersonalizationExample,
  PersonalizationUser,
} from '../types.js';

export interface BuildPersonalizedPromptArgs {
  readonly basePrompt: string;
  readonly user: PersonalizationUser;
  readonly examples: ReadonlyArray<PersonalizationExample>;
  readonly queryEmbedding?: ReadonlyArray<number>;
  /** Max examples to include. Default 5 — Anthropic few-shot sweet spot. */
  readonly k?: number;
  /** Soft cap on total tokens. Default 4000. */
  readonly tokenBudget?: number;
  /** Token counter — defaults to a length/4 heuristic. */
  readonly tokenCounter?: (text: string) => number;
  /** Override the section header for examples. */
  readonly examplesHeader?: string;
}

const DEFAULT_K = 5;
const DEFAULT_BUDGET = 4000;
const DEFAULT_EXAMPLES_HEADER = '## Examples from this user';

function defaultTokenCounter(text: string): number {
  // ~4 chars per token; whitespace ignored. Conservative.
  return Math.ceil(text.length / 4);
}

function preferenceSummary(user: PersonalizationUser): string {
  if (!user.preferences) return '';
  const lines: string[] = [];
  for (const [k, v] of Object.entries(user.preferences)) {
    if (v == null) continue;
    if (typeof v === 'object') {
      lines.push(`- ${k}: ${JSON.stringify(v)}`);
    } else {
      lines.push(`- ${k}: ${String(v)}`);
    }
  }
  if (lines.length === 0) return '';
  return `## User preferences\n${lines.join('\n')}`;
}

function rankExamples(
  examples: ReadonlyArray<PersonalizationExample>,
  queryEmbedding: ReadonlyArray<number> | undefined,
): PersonalizationExample[] {
  if (!queryEmbedding) {
    // Recency fallback when no embedding is available.
    return [...examples].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return [...examples]
    .map((e) => ({
      e,
      score: e.embedding ? cosineSimilarity(queryEmbedding, e.embedding) : 0,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tie-break by recency.
      return b.e.createdAt.localeCompare(a.e.createdAt);
    })
    .map((s) => s.e);
}

export function buildPersonalizedPrompt(
  args: BuildPersonalizedPromptArgs,
): string {
  const k = args.k ?? DEFAULT_K;
  const budget = args.tokenBudget ?? DEFAULT_BUDGET;
  const counter = args.tokenCounter ?? defaultTokenCounter;
  const header = args.examplesHeader ?? DEFAULT_EXAMPLES_HEADER;

  const onlyForUser = args.examples.filter(
    (e) => e.userId === args.user.userId,
  );
  const ranked = rankExamples(onlyForUser, args.queryEmbedding).slice(0, k);

  const prefBlock = preferenceSummary(args.user);

  // Start with everything, then trim examples from the bottom until we fit.
  let included = ranked.slice();
  const buildOutput = (examples: PersonalizationExample[]): string => {
    const parts: string[] = [args.basePrompt.trim()];
    if (prefBlock) parts.push(prefBlock);
    if (examples.length > 0) {
      const exBlock: string[] = [header];
      for (const e of examples) {
        exBlock.push(`### ${e.kind} (${e.createdAt})`);
        exBlock.push(e.content);
      }
      parts.push(exBlock.join('\n'));
    }
    return parts.join('\n\n');
  };

  while (included.length > 0 && counter(buildOutput(included)) > budget) {
    included = included.slice(0, -1);
  }
  return buildOutput(included);
}
