/**
 * Tree-of-Thoughts (ToT) search-based planner.
 *
 * Adds planning intelligence beyond the linear 13-step pipeline. Where
 * the legacy `Plan` tree only records the *result* of a planner-LLM's
 * decomposition, this module *searches* the space of possible next
 * thoughts via beam search:
 *
 *   1. Root the search at the user's goal.
 *   2. At each depth, ask the `expander` (typically a Haiku-backed LLM
 *      sensor) for K alternative continuations of every beam member.
 *   3. Score each child via the `evaluator` (default: cosine similarity
 *      between thought content and goal embedding).
 *   4. Keep the top `beamWidth` children for the next layer; prune any
 *      whose score collapses by > 0.3 vs. their parent (too divergent).
 *   5. Stop early when any thought scores >= 0.85 (good enough) OR the
 *      token budget runs out OR the 50-expansion hard cap trips.
 *
 * All thoughts are immutable. The function returns a {@link PlanCandidate}
 * containing every thought visited (including pruned ones), the chosen
 * `bestPath` of thought IDs from root → best leaf, the best score, and
 * a count of pruned thoughts.
 *
 * Coexists with — does NOT replace — `plan.ts`. Wiring this into the
 * main loop is a deliberate follow-up so we can A/B the linear vs.
 * search-based planner end-to-end.
 *
 * Determinism: given a deterministic `evaluator` and `expander`, the
 * planner returns the same `PlanCandidate` on every call. Children with
 * equal scores are ordered by their position in the expander's output,
 * which the expander controls.
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * A single node in the thought tree. Immutable.
 *
 * @property id        Globally unique within one search call.
 * @property content   The natural-language thought.
 * @property depth     0 for the root, 1 for its children, etc.
 * @property parentId  null for the root.
 * @property score     0..1 confidence the path completes the goal.
 *                     0 for the root (we don't score the goal itself).
 * @property explored  true once we have expanded children from it OR
 *                     decided not to (pruned / hit budget / hit cap).
 */
export interface Thought {
  readonly id: string;
  readonly content: string;
  readonly depth: number;
  readonly parentId: string | null;
  readonly score: number;
  readonly explored: boolean;
}

/**
 * Final output of one `searchPlan` call.
 *
 * @property thoughts   Every thought the search touched, in
 *                      breadth-first visit order. Includes pruned ones
 *                      so downstream debug UIs can render the full
 *                      explored tree.
 * @property rootGoal   Echo of the input goal string.
 * @property bestPath   Thought IDs from the root to the highest-scoring
 *                      reachable thought. Length is `1 + depthOfBest`.
 * @property bestScore  Score of the leaf at the tail of `bestPath`.
 * @property pruned     How many thoughts we did NOT explore (divergence
 *                      prune + cap prune + budget prune).
 */
export interface PlanCandidate {
  readonly thoughts: ReadonlyArray<Thought>;
  readonly rootGoal: string;
  readonly bestPath: ReadonlyArray<string>;
  readonly bestScore: number;
  readonly pruned: number;
}

/**
 * Context handed to the evaluator. Today this is just the goal text;
 * we keep the type open so future evaluators can take embeddings,
 * memory snapshots, etc., without breaking callers.
 */
export interface PlanContext {
  readonly goal: string;
}

/**
 * Async oracle that turns a thought + context into a 0..1 score.
 * Implementations MUST clamp to [0, 1]; the planner will clamp again
 * as defence-in-depth.
 */
export type Evaluator = (
  thought: Thought,
  context: PlanContext,
) => Promise<number>;

/**
 * Async oracle that expands a thought into up to `k` next-step
 * candidates. Returning fewer than `k` is fine. Returning an empty
 * array signals "this branch is a dead end" — the planner marks the
 * parent explored and moves on.
 */
export type Expander = (thought: Thought, k: number) => Promise<Thought[]>;

/**
 * Sensor adapter contract for the default LLM-backed expander. Pull-out
 * type so callers can mock it in tests without dragging the Anthropic
 * SDK into the central-intelligence package.
 */
export interface SensorAdapter {
  call(prompt: string): Promise<string>;
}

/**
 * Tiny embedder contract for the default heuristic evaluator. Any
 * function that turns a string into a numeric vector works — we don't
 * care about the model.
 */
export type Embedder = (text: string) => Promise<ReadonlyArray<number>>;

/**
 * Options for `searchPlan`. Sensible defaults are exposed below.
 */
export interface SearchPlanOptions {
  readonly branchingFactor?: number;
  readonly maxDepth?: number;
  readonly beamWidth?: number;
  readonly budgetTokens?: number;
  readonly earlyExitScore?: number;
  readonly divergenceThreshold?: number;
  readonly evaluator: Evaluator;
  readonly expander: Expander;
  readonly idGenerator?: () => string;
}

// ─────────────────────────────────────────────────────────────────────
// Defaults — exported so callers can read the canonical numbers.
// ─────────────────────────────────────────────────────────────────────

/** Default K — how many children we ask for per parent. */
export const DEFAULT_BRANCHING_FACTOR = 3;
/** Default max depth — root is depth 0, so 4 means up to 4 expansion layers. */
export const DEFAULT_MAX_DEPTH = 4;
/** Default beam width — survivors carried to the next layer. */
export const DEFAULT_BEAM_WIDTH = 3;
/** Default token budget — generous enough for Haiku-class expanders. */
export const DEFAULT_BUDGET_TOKENS = 25_000;
/** Stop-early threshold. */
export const DEFAULT_EARLY_EXIT_SCORE = 0.85;
/** Prune if child collapses by more than this vs. parent. */
export const DEFAULT_DIVERGENCE_THRESHOLD = 0.3;
/** Rough per-expander-call token estimate for the budget guard. */
export const ESTIMATED_TOKENS_PER_EXPANSION = 500;
/** Hard cap on expander calls per `searchPlan` invocation. */
export const HARD_MAX_EXPANSIONS = 50;

// ─────────────────────────────────────────────────────────────────────
// Core search
// ─────────────────────────────────────────────────────────────────────

/**
 * Run a Tree-of-Thoughts beam search rooted at `goal`. See module
 * comment for the algorithm. Pure w.r.t. its inputs aside from the ID
 * generator and the injected async oracles.
 */
export async function searchPlan(
  goal: string,
  options: SearchPlanOptions,
): Promise<PlanCandidate> {
  const branchingFactor = clampPositive(
    options.branchingFactor,
    DEFAULT_BRANCHING_FACTOR,
  );
  const maxDepth = clampPositive(options.maxDepth, DEFAULT_MAX_DEPTH);
  const beamWidth = clampPositive(options.beamWidth, DEFAULT_BEAM_WIDTH);
  const budgetTokens = clampPositive(
    options.budgetTokens,
    DEFAULT_BUDGET_TOKENS,
  );
  const earlyExitScore = clampUnit(
    options.earlyExitScore,
    DEFAULT_EARLY_EXIT_SCORE,
  );
  const divergenceThreshold = clampUnit(
    options.divergenceThreshold,
    DEFAULT_DIVERGENCE_THRESHOLD,
  );
  const nextId = options.idGenerator ?? defaultIdGenerator();

  const context: PlanContext = { goal };
  const root: Thought = {
    id: nextId(),
    content: goal,
    depth: 0,
    parentId: null,
    score: 0,
    explored: false,
  };

  const visited: Thought[] = [root];
  let beam: ReadonlyArray<Thought> = [root];
  let bestThought: Thought = root;
  let bestScore = 0;
  let expansionsUsed = 0;
  let pruned = 0;

  // The scorer is the only place we touch the evaluator. We swallow
  // throws here so one buggy oracle call cannot abort the whole search.
  async function safeEvaluate(t: Thought): Promise<number | null> {
    try {
      const raw = await options.evaluator(t, context);
      return clampUnit(raw, 0);
    } catch {
      return null;
    }
  }

  outer: for (let depth = 0; depth < maxDepth; depth += 1) {
    const nextBeamCandidates: Thought[] = [];

    for (const parent of beam) {
      // Budget / cap guards — bail with best-so-far if we'd blow either.
      if (expansionsUsed >= HARD_MAX_EXPANSIONS) {
        pruned += countRemaining(beam, parent) + nextBeamCandidates.length;
        markExploredRemaining(visited, beam, parent);
        break outer;
      }
      const projectedTokens =
        (expansionsUsed + 1) * ESTIMATED_TOKENS_PER_EXPANSION;
      if (projectedTokens > budgetTokens) {
        pruned += countRemaining(beam, parent) + nextBeamCandidates.length;
        markExploredRemaining(visited, beam, parent);
        break outer;
      }

      expansionsUsed += 1;

      let rawChildren: Thought[];
      try {
        rawChildren = await options.expander(parent, branchingFactor);
      } catch {
        rawChildren = [];
      }

      // Normalise: the expander is a black box — we re-stamp IDs, depth,
      // and parent pointers so callers can't break the invariants.
      const normalised = rawChildren
        .slice(0, branchingFactor)
        .map((c) =>
          freezeThought({
            id: nextId(),
            content: c.content,
            depth: parent.depth + 1,
            parentId: parent.id,
            score: 0,
            explored: false,
          }),
        );

      replaceVisited(visited, parent.id, { ...parent, explored: true });

      // Score every child. Throws are caught → that child is dropped.
      for (const child of normalised) {
        const score = await safeEvaluate(child);
        if (score === null) {
          pruned += 1;
          continue;
        }
        const scoredChild = freezeThought({ ...child, score });

        // Divergence prune — child must not collapse vs. parent score.
        if (
          parent.depth > 0 &&
          parent.score - scoredChild.score > divergenceThreshold
        ) {
          visited.push(freezeThought({ ...scoredChild, explored: true }));
          pruned += 1;
          continue;
        }

        visited.push(scoredChild);
        nextBeamCandidates.push(scoredChild);

        if (scoredChild.score > bestScore) {
          bestScore = scoredChild.score;
          bestThought = scoredChild;
        }
      }

      // Early exit — bail as soon as we hit "good enough".
      if (bestScore >= earlyExitScore) {
        pruned += nextBeamCandidates.length - includeBestCount(
          nextBeamCandidates,
          bestThought.id,
        );
        break outer;
      }
    }

    if (nextBeamCandidates.length === 0) {
      // Nobody survived this layer; nothing to expand from next round.
      break;
    }

    // Top-beamWidth survivors become the next layer. Everyone else is
    // pruned (but already in `visited` so the debug UI sees them).
    const sorted = [...nextBeamCandidates].sort((a, b) => b.score - a.score);
    const survivors = sorted.slice(0, beamWidth);
    pruned += sorted.length - survivors.length;
    beam = survivors;
  }

  return Object.freeze({
    thoughts: Object.freeze(visited.map(freezeThought)),
    rootGoal: goal,
    bestPath: tracePath(visited, bestThought.id),
    bestScore,
    pruned,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Default heuristic evaluator — cosine similarity via injected embedder.
// ─────────────────────────────────────────────────────────────────────

/**
 * Build an {@link Evaluator} that scores `thought.content` by cosine
 * similarity against the goal embedding. The goal embedding is computed
 * once on first call and cached per-evaluator-instance.
 *
 * No external dependency — cosine is a 10-line numeric op. Edge case:
 * if either vector is all zeros, returns 0.
 */
export function heuristicEvaluator(embedder: Embedder): Evaluator {
  let goalVector: ReadonlyArray<number> | null = null;
  let lastGoal: string | null = null;

  return async (thought, context) => {
    if (lastGoal !== context.goal) {
      goalVector = await embedder(context.goal);
      lastGoal = context.goal;
    }
    if (!goalVector) return 0;

    const candidateVector = await embedder(thought.content);
    return cosineSimilarity(goalVector, candidateVector);
  };
}

/**
 * Compute cosine similarity between two equal-length vectors. Output
 * is in [-1, 1]; callers that need a confidence may want to clamp to
 * [0, 1] (which `searchPlan` does for them).
 */
export function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (a.length === 0 || b.length === 0) return 0;
  const len = Math.min(a.length, b.length);

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ─────────────────────────────────────────────────────────────────────
// Default LLM-backed expander — Haiku-style "give me K next thoughts".
// ─────────────────────────────────────────────────────────────────────

/**
 * Build an {@link Expander} that calls the supplied `sensor` to ask
 * for K alternative next-step thoughts. The sensor returns raw text;
 * we parse one thought per non-empty line and stop at K.
 *
 * Robust to messy LLM output:
 *   - strips leading bullets / numbering ("- ", "1. ", "* ")
 *   - drops empty lines
 *   - truncates to K
 *   - returns [] on sensor throw (caller's planner handles the rest)
 */
export function llmExpander(sensor: SensorAdapter): Expander {
  return async (thought, k) => {
    const prompt = buildExpanderPrompt(thought, k);
    let raw: string;
    try {
      raw = await sensor.call(prompt);
    } catch {
      return [];
    }
    return parseExpanderResponse(raw, thought, k);
  };
}

/**
 * Exposed so callers can build their own expander with a different
 * prompt template while still parsing the response the same way.
 */
export function buildExpanderPrompt(thought: Thought, k: number): string {
  return [
    `You are a planning sensor. Given the current thought, propose ${k}`,
    `distinct next-step thoughts that advance toward the root goal.`,
    'Each thought MUST be one short line, no commentary, no numbering.',
    '',
    `Current thought (depth ${thought.depth}): ${thought.content}`,
    '',
    `Return exactly ${k} lines, one thought per line.`,
  ].join('\n');
}

function parseExpanderResponse(
  raw: string,
  parent: Thought,
  k: number,
): Thought[] {
  const lines = raw
    .split(/\r?\n/u)
    .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s+/u, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, k);

  return lines.map((content) => ({
    id: 'placeholder',
    content,
    depth: parent.depth + 1,
    parentId: parent.id,
    score: 0,
    explored: false,
  }));
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

function defaultIdGenerator(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `t_${n}`;
  };
}

function clampPositive(v: number | undefined, fallback: number): number {
  if (v === undefined || !Number.isFinite(v) || v <= 0) return fallback;
  return v;
}

function clampUnit(v: number | undefined, fallback: number): number {
  if (v === undefined || !Number.isFinite(v)) return fallback;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function freezeThought(t: Thought): Thought {
  return Object.freeze({ ...t });
}

/**
 * Walk back from the leaf to the root, returning IDs in root-first
 * order. Defensive — if the parent chain ever breaks (it shouldn't),
 * we stop where the chain ends rather than throwing.
 */
function tracePath(
  visited: ReadonlyArray<Thought>,
  leafId: string,
): ReadonlyArray<string> {
  const byId = new Map(visited.map((t) => [t.id, t] as const));
  const path: string[] = [];
  let cursor: string | null = leafId;
  const guard = visited.length + 1;
  let steps = 0;
  while (cursor && steps < guard) {
    path.push(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    cursor = node.parentId;
    steps += 1;
  }
  return path.reverse();
}

/**
 * Replace the visited entry for `id` with `next`. We use this to flip
 * the `explored` flag on parents we've finished with. Mutates the
 * array element slot (not the Thought) — Thoughts themselves remain
 * frozen.
 */
function replaceVisited(
  visited: Thought[],
  id: string,
  next: Thought,
): void {
  for (let i = 0; i < visited.length; i += 1) {
    if (visited[i]?.id === id) {
      visited[i] = freezeThought(next);
      return;
    }
  }
}

/**
 * Count beam members we skipped after `current` — used so the
 * `pruned` counter stays honest when we bail out of the outer loop.
 */
function countRemaining(
  beam: ReadonlyArray<Thought>,
  current: Thought,
): number {
  const idx = beam.findIndex((t) => t.id === current.id);
  if (idx < 0) return 0;
  return beam.length - idx;
}

/**
 * On budget/cap bail, mark every remaining beam member starting from
 * `from` as explored — they were considered, just not expanded.
 */
function markExploredRemaining(
  visited: Thought[],
  beam: ReadonlyArray<Thought>,
  from: Thought,
): void {
  const idx = beam.findIndex((t) => t.id === from.id);
  if (idx < 0) return;
  for (let i = idx; i < beam.length; i += 1) {
    const t = beam[i];
    if (!t) continue;
    replaceVisited(visited, t.id, { ...t, explored: true });
  }
}

/**
 * Helper for the early-exit accounting: how many candidates in
 * `pool` would survive if we only kept the best.
 */
function includeBestCount(
  pool: ReadonlyArray<Thought>,
  bestId: string,
): number {
  return pool.some((t) => t.id === bestId) ? 1 : 0;
}
