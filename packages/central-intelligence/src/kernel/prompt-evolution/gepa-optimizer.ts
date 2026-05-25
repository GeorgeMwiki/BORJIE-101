/**
 * GEPA-style prompt optimiser.
 *
 * B4 Phase B — Progressive Intelligence.
 *
 * DSPy GEPA (Greedy Evolutionary Prompt Adapter, Stanford July 2025)
 * is a Python framework that compiles prompts against a golden set
 * via mutation + Pareto-improvement filtering. We port the essential
 * loop in TypeScript so the brain's weekly recompile stage doesn't
 * need a Python bridge.
 *
 * Pseudocode:
 *
 *   bestPrompt   ← basePrompt
 *   bestScore    ← score(bestPrompt, goldenSet)
 *   bestNewScore ← score(bestPrompt, newTraces)
 *
 *   for i in 1..iterations:
 *     candidate          ← mutate(bestPrompt, traceCues)
 *     goldenScore        ← score(candidate, goldenSet)
 *     newTracesScore     ← score(candidate, newTraces)
 *
 *     // Pareto-improvement gate (CRITICAL — no regression on golden).
 *     if goldenScore < bestScore: continue
 *     // Strict improvement on new traces — else we just paraphrase noise.
 *     if newTracesScore <= bestNewScore: continue
 *
 *     bestPrompt   ← candidate
 *     bestScore    ← goldenScore
 *     bestNewScore ← newTracesScore
 *
 *   return bestPrompt, bestScore
 *
 * Mutations are small, deterministic textual operations on the prompt
 * (paraphrase / append-example / re-order) so a repeat run with the
 * same RNG seed produces the same trajectory.
 *
 * Promotion is a SEPARATE step (`promotePrompt`) that the caller runs
 * after A/B testing the new prompt against production traffic for a
 * short period. The optimiser only RANKS — it never promotes itself.
 */

import type {
  EvalCase,
  GoldenSet,
} from './golden-set.js';

export interface PromptEvaluator {
  /**
   * Score `prompt` against `evalCases`. Score ∈ [0, 1] where 1 is
   * "every case passed". Implementation can be exact-match, fuzzy
   * match, or an LLM-judge — the optimiser is agnostic.
   */
  evaluate(
    prompt: string,
    evalCases: ReadonlyArray<EvalCase>,
  ): Promise<number>;
}

export interface PromptMutator {
  /**
   * Produce a mutated variant of `basePrompt`. Diversity is enforced
   * by the optimiser (it tracks already-seen variants); the mutator
   * just needs to make a small, syntactically-valid edit.
   */
  mutate(basePrompt: string, iteration: number): Promise<string>;
}

export interface OptimizePromptArgs {
  readonly basePrompt: string;
  readonly traces: ReadonlyArray<EvalCase>;
  readonly goldenSet: GoldenSet;
  readonly iterations: number;
  readonly evaluator: PromptEvaluator;
  readonly mutator: PromptMutator;
}

export interface OptimizePromptResult {
  readonly newPrompt: string;
  readonly goldenScore: number;
  readonly newTracesScore: number;
  readonly mutationsTried: number;
  readonly mutationsAccepted: number;
  readonly improved: boolean;
}

const MAX_ITERATIONS = 100;

export async function optimizePrompt(
  args: OptimizePromptArgs,
): Promise<OptimizePromptResult> {
  const basePrompt = (args.basePrompt ?? '').trim();
  if (!basePrompt) {
    throw new Error('optimizePrompt: basePrompt is required');
  }
  const iterations = clampIterations(args.iterations);

  let bestPrompt = basePrompt;
  let bestGolden = await args.evaluator.evaluate(
    bestPrompt,
    args.goldenSet.cases,
  );
  let bestNew =
    args.traces.length > 0
      ? await args.evaluator.evaluate(bestPrompt, args.traces)
      : 0;

  const seen = new Set<string>([basePrompt]);
  let mutationsTried = 0;
  let mutationsAccepted = 0;

  for (let i = 0; i < iterations; i += 1) {
    const candidate = (await args.mutator.mutate(bestPrompt, i)).trim();
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    mutationsTried += 1;

    const goldenScore = await args.evaluator.evaluate(
      candidate,
      args.goldenSet.cases,
    );
    // Pareto-improvement gate: no regression on the golden set.
    if (goldenScore < bestGolden) continue;

    const newScore =
      args.traces.length > 0
        ? await args.evaluator.evaluate(candidate, args.traces)
        : 0;
    // Strict improvement on the new-traces eval — else paraphrase noise.
    if (args.traces.length > 0 && newScore <= bestNew) continue;

    bestPrompt = candidate;
    bestGolden = goldenScore;
    bestNew = newScore;
    mutationsAccepted += 1;
  }

  return {
    newPrompt: bestPrompt,
    goldenScore: bestGolden,
    newTracesScore: bestNew,
    mutationsTried,
    mutationsAccepted,
    improved: bestPrompt !== basePrompt,
  };
}

function clampIterations(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(Math.floor(n), MAX_ITERATIONS);
}

// ─────────────────────────────────────────────────────────────────────
// Default mutators
// ─────────────────────────────────────────────────────────────────────

export interface DefaultMutatorOptions {
  /** Seed for the pseudo-random sequence (deterministic). */
  readonly seed?: number;
  /** Example bank used by the `append-example` mutation. */
  readonly examples?: ReadonlyArray<string>;
}

/**
 * Default mutator — three deterministic mutation operations cycled
 * by iteration index:
 *
 *   1. paraphrase   — wrap the prompt in a "Rephrase: " preamble
 *   2. append-example — append "Example: <ex>" from a fixed pool
 *   3. re-order      — swap the first sentence to the end
 *
 * NOTE: this is a baseline. Production wires a Haiku-backed mutator
 * (free-form LLM rewrite); the default ships a deterministic version
 * for tests + offline replay.
 */
export function createDefaultMutator(
  options: DefaultMutatorOptions = {},
): PromptMutator {
  const examples = options.examples ?? [
    'A tenant asks "ninapata risiti?" → respond in Swahili with the receipt link.',
    'A maintenance ticket arrives flagged "leaking pipe" → escalate to P1 SLA.',
  ];
  let counter = options.seed ?? 0;
  return {
    async mutate(basePrompt) {
      counter += 1;
      const op = counter % 3;
      if (op === 0) {
        return `Rephrase the user's question, then answer concisely.\n\n${basePrompt}`;
      } else if (op === 1) {
        const example = examples[counter % examples.length] ?? '';
        return `${basePrompt}\n\nExample: ${example}`;
      }
      // re-order
      const sentences = basePrompt
        .split(/(?<=\.)\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (sentences.length <= 1) return `${basePrompt} Note carefully.`;
      const [first, ...rest] = sentences;
      return `${rest.join(' ')} ${first}`;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Default evaluator — exact-match against expectedOutput.
// ─────────────────────────────────────────────────────────────────────

export interface ExactMatchEvaluatorOptions {
  /** Caller-provided scorer that runs the prompt against an input. */
  readonly run: (prompt: string, input: string) => Promise<string>;
}

/**
 * Exact-match scorer. Production composition wires an LLM-judge or a
 * domain-specific scorer; tests use this trivially deterministic
 * evaluator.
 */
export function createExactMatchEvaluator(
  options: ExactMatchEvaluatorOptions,
): PromptEvaluator {
  return {
    async evaluate(prompt, evalCases) {
      if (evalCases.length === 0) return 0;
      let hits = 0;
      for (const c of evalCases) {
        try {
          const actual = (await options.run(prompt, c.input)).trim();
          if (actual === c.expectedOutput.trim()) hits += 1;
        } catch {
          // Failure counts as 0; continue.
        }
      }
      return hits / evalCases.length;
    },
  };
}
