/**
 * Context budget — keeps the assembled prompt under the 80%-of-window
 * threshold so the model retains headroom for its own response.
 *
 * Two responsibilities:
 *
 *   1. `compactIfOver(transcript, ratio)` — when the rolling transcript
 *      exceeds `ratio * windowSize` tokens, fold the oldest turns into
 *      a synopsis block ("[summary of turns 1..N]") so the recent
 *      turns survive intact.
 *
 *   2. `ToolSearch` primitive — instead of loading the full tool
 *      registry into every request, expose a `searchRelevant(goal, k)`
 *      surface that returns the top-k tools by goal-similarity. Mirrors
 *      Anthropic's deferred-tool ToolSearch pattern.
 *
 * The compactor is provider-agnostic; token counts come from an injected
 * `tokenCounter` so tests run with a deterministic word-count stub and
 * production wires tiktoken / Anthropic's counter.
 */

import type { TranscriptTurn } from './checkpoint.js';

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_WINDOW_TOKENS = 200_000;
export const DEFAULT_COMPACT_RATIO = 0.8;
export const DEFAULT_KEEP_RECENT_TURNS = 6;

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface TokenCounter {
  count(text: string): number;
}

export interface ContextBudgetDeps {
  readonly windowTokens?: number;
  readonly keepRecentTurns?: number;
  readonly tokenCounter?: TokenCounter;
  /** Optional caller-supplied synopsis function — receives folded turns. */
  readonly summarise?: (
    turns: ReadonlyArray<TranscriptTurn>,
  ) => Promise<string>;
}

export interface CompactionOutcome {
  readonly turns: ReadonlyArray<TranscriptTurn>;
  readonly compacted: boolean;
  readonly originalTokens: number;
  readonly finalTokens: number;
  readonly synopsisInsertedAt: number;
}

export interface ContextBudget {
  compactIfOver(
    transcript: ReadonlyArray<TranscriptTurn>,
    ratio?: number,
  ): Promise<CompactionOutcome>;
  countTokens(text: string): number;
}

// ─────────────────────────────────────────────────────────────────────
// ToolSearch — deferred-tool primitive.
// ─────────────────────────────────────────────────────────────────────

export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly keywords: ReadonlyArray<string>;
  /**
   * Optional sample-args blob, concatenated into the embedding corpus
   * so semantically related tools whose names differ are still
   * retrievable (e.g. `sendSms({to})` vs `notifyTenant({phone})`).
   */
  readonly sampleArgs?: ReadonlyArray<string>;
}

export interface ToolSearch {
  /** Top-k tools by overlap between the goal text and each tool's keywords. */
  searchRelevant(goal: string, k: number): Promise<ReadonlyArray<ToolDescriptor>>;
}

// ─────────────────────────────────────────────────────────────────────
// Embedding-indexed ToolSearch — Anthropic deferred-tool pattern.
//
// Pre-computes embeddings of `(name + description + sample-args)` for
// every registered tool at boot. At query time it embeds the goal and
// returns top-k by cosine. Embeddings are cached in a Map keyed by the
// concatenated corpus text so re-initialisations with the same tool
// set are free.
//
// Falls back to the keyword overlap ranker when the embedder is null
// or rejects the goal — the kernel must not block on the embedder.
// ─────────────────────────────────────────────────────────────────────

export interface EmbeddingToolSearchDeps {
  readonly embedder: import('../kernel-types.js').TextEmbedder | null;
  /**
   * Optional shared cache across instances (e.g. a Map injected by the
   * composition root). Tests pass a fresh Map per assertion.
   */
  readonly cache?: Map<string, ReadonlyArray<number>>;
  /**
   * Optional fallback search used when the embedder is missing or
   * throws. Defaults to the keyword ranker.
   */
  readonly fallback?: ToolSearch;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createContextBudget(
  deps: ContextBudgetDeps = {},
): ContextBudget {
  const windowTokens = deps.windowTokens ?? DEFAULT_WINDOW_TOKENS;
  const keepRecent = deps.keepRecentTurns ?? DEFAULT_KEEP_RECENT_TURNS;
  const counter = deps.tokenCounter ?? createWordCountTokenCounter();
  const summariser = deps.summarise ?? defaultSummariser;

  function countTokens(text: string): number {
    return counter.count(text);
  }

  function tokensOf(turns: ReadonlyArray<TranscriptTurn>): number {
    return turns.reduce((sum, t) => sum + counter.count(t.content), 0);
  }

  async function compactIfOver(
    transcript: ReadonlyArray<TranscriptTurn>,
    ratio: number = DEFAULT_COMPACT_RATIO,
  ): Promise<CompactionOutcome> {
    const originalTokens = tokensOf(transcript);
    const threshold = Math.floor(windowTokens * ratio);
    if (originalTokens <= threshold) {
      return {
        turns: transcript,
        compacted: false,
        originalTokens,
        finalTokens: originalTokens,
        synopsisInsertedAt: -1,
      };
    }
    const recent = transcript.slice(-keepRecent);
    const older = transcript.slice(0, transcript.length - keepRecent);
    const synopsis = await summariser(older);
    const synopsisTurn: TranscriptTurn = {
      role: 'assistant',
      content: `[synopsis of ${older.length} earlier turns]\n${synopsis}`,
      timestamp: new Date().toISOString(),
    };
    const next = [synopsisTurn, ...recent];
    return {
      turns: next,
      compacted: true,
      originalTokens,
      finalTokens: tokensOf(next),
      synopsisInsertedAt: 0,
    };
  }

  return { compactIfOver, countTokens };
}

// ─────────────────────────────────────────────────────────────────────
// Default in-memory ToolSearch — keyword overlap ranker.
// ─────────────────────────────────────────────────────────────────────

export function createInMemoryToolSearch(
  tools: ReadonlyArray<ToolDescriptor>,
): ToolSearch {
  return {
    async searchRelevant(
      goal: string,
      k: number,
    ): Promise<ReadonlyArray<ToolDescriptor>> {
      const goalTokens = tokenise(goal);
      const ranked = tools
        .map((t) => ({
          tool: t,
          score: overlap(goalTokens, [...t.keywords, ...tokenise(t.description)]),
        }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(1, k))
        .map((r) => r.tool);
      return ranked;
    },
  };
}

/**
 * Embedding-indexed ToolSearch. Pre-computes the corpus embedding for
 * every tool at construction time (lazily on first query if the cache
 * is cold) and returns top-k by cosine similarity to the goal.
 *
 * Two failure modes degrade to the keyword fallback:
 *   1. The embedder is `null` (no API key configured).
 *   2. The embedder rejects when embedding the goal text.
 *
 * Per-tool corpus failures during pre-compute are tolerated: the tool
 * is excluded from the embedding pool but remains visible via the
 * keyword fallback if the embedder later fails for the goal.
 */
export function createEmbeddingToolSearch(
  tools: ReadonlyArray<ToolDescriptor>,
  deps: EmbeddingToolSearchDeps,
): ToolSearch {
  const embedder = deps.embedder;
  const cache = deps.cache ?? new Map<string, ReadonlyArray<number>>();
  const fallback = deps.fallback ?? createInMemoryToolSearch(tools);
  let warmed: ReadonlyArray<{
    readonly tool: ToolDescriptor;
    readonly corpus: string;
    embedding: ReadonlyArray<number> | null;
  }> | null = null;

  function warm(): ReadonlyArray<{
    readonly tool: ToolDescriptor;
    readonly corpus: string;
    embedding: ReadonlyArray<number> | null;
  }> {
    if (warmed !== null) return warmed;
    warmed = tools.map((tool) => {
      const corpus = buildCorpus(tool);
      const cached = cache.get(corpus);
      return {
        tool,
        corpus,
        embedding: cached ?? null,
      };
    });
    return warmed;
  }

  async function ensureEmbeddings(): Promise<void> {
    if (embedder === null) return;
    const slots = warm();
    await Promise.all(
      slots.map(async (slot) => {
        if (slot.embedding !== null) return;
        try {
          const vec = await embedder.embed(slot.corpus);
          if (Array.isArray(vec) && vec.length > 0) {
            slot.embedding = vec;
            cache.set(slot.corpus, vec);
          }
        } catch {
          // tool drops out of the embedding pool until next warm cycle
        }
      }),
    );
  }

  return {
    async searchRelevant(
      goal: string,
      k: number,
    ): Promise<ReadonlyArray<ToolDescriptor>> {
      if (typeof goal !== 'string' || !goal.trim()) return [];
      const limit = Math.max(1, k);
      if (embedder === null) {
        return fallback.searchRelevant(goal, limit);
      }
      let goalVec: ReadonlyArray<number>;
      try {
        goalVec = await embedder.embed(goal);
      } catch {
        return fallback.searchRelevant(goal, limit);
      }
      if (!Array.isArray(goalVec) || goalVec.length === 0) {
        return fallback.searchRelevant(goal, limit);
      }
      await ensureEmbeddings();
      const slots = warm();
      const ranked = slots
        .map((slot) => {
          if (slot.embedding === null) return { tool: slot.tool, score: -1 };
          if (slot.embedding.length !== goalVec.length) {
            return { tool: slot.tool, score: -1 };
          }
          return {
            tool: slot.tool,
            score: cosineForTools(goalVec, slot.embedding),
          };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((r) => r.tool);
      if (ranked.length === 0) {
        return fallback.searchRelevant(goal, limit);
      }
      return ranked;
    },
  };
}

function buildCorpus(tool: ToolDescriptor): string {
  const parts = [tool.name, tool.description, ...(tool.keywords ?? [])];
  if (Array.isArray(tool.sampleArgs)) {
    parts.push(...tool.sampleArgs);
  }
  return parts.filter((p) => typeof p === 'string' && p.length > 0).join(' ');
}

function cosineForTools(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i] as number;
    const bi = b[i] as number;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ─────────────────────────────────────────────────────────────────────
// Internal — token counter + summariser defaults.
// ─────────────────────────────────────────────────────────────────────

function createWordCountTokenCounter(): TokenCounter {
  return {
    count(text: string): number {
      if (!text) return 0;
      // Cheap heuristic: 1 token ≈ 0.75 words. Tests override via dep.
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      return Math.ceil(words / 0.75);
    },
  };
}

async function defaultSummariser(
  turns: ReadonlyArray<TranscriptTurn>,
): Promise<string> {
  const parts = turns.map((t) => `${t.role}: ${t.content.slice(0, 80)}`);
  return parts.join('\n');
}

function tokenise(text: string): ReadonlyArray<string> {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

function overlap(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): number {
  const setA = new Set(a);
  let count = 0;
  for (const w of b) if (setA.has(w)) count += 1;
  return count;
}
