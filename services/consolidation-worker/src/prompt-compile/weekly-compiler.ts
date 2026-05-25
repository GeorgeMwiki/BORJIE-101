/**
 * Weekly prompt compiler — orchestrates the Claude mutator + Haiku
 * evaluator inside B4's GEPA optimiser loop.
 *
 * Phase C — C7. B4 shipped:
 *   - `gepa-optimizer.ts` — Pareto-improvement gate around a generic
 *     `PromptMutator` + `PromptEvaluator` pair.
 *   - `golden-set.ts` — SHA256-versioned frozen 5-capability case list.
 *
 * This module wires the real Claude/Haiku adapters into that loop and
 * exposes a single `compile()` method that the consolidation worker's
 * stage 09 calls — once per capability in the golden set.
 *
 * Why a small `maxIterations` (default 5)?
 * GEPA's paper uses 100 iterations against an offline benchmark. In
 * production we run weekly, on Sundays, against a live golden set. A
 * 100-iteration run for each of the 5 capabilities = 500 Opus calls +
 * 500 * `mutationCount` Haiku scoring calls per week, which would
 * dwarf the rest of the brain's spend. 5 iterations is enough to catch
 * "obvious" improvements; the architecture notes that prompt evolution
 * is supposed to be a SLOW signal — fast convergence is anti-pattern.
 *
 * Duck-typed GEPA contract:
 * We avoid a compile-time dependency on `@borjie/central-intelligence`
 * by re-declaring `optimizePrompt`'s argument and result shape locally.
 * The composition root passes in the real function from the kernel
 * package — at the call site, structural typing collapses the two
 * declarations to one.
 */

import type { GoldenCase, ClaudeMutator } from './claude-mutator.js';
import type { HaikuEvaluator } from './haiku-evaluator.js';

// ---------------------------------------------------------------------------
// Duck-typed GEPA contract (mirrors `gepa-optimizer.ts`).
// ---------------------------------------------------------------------------

export interface EvalCase {
  readonly id: string;
  readonly input: string;
  readonly expectedOutput: string;
  readonly capability: string;
}

export interface GoldenSet {
  readonly cases: ReadonlyArray<EvalCase>;
  readonly version: string;
  readonly frozenAt: string;
}

export interface PromptEvaluatorPort {
  evaluate(
    prompt: string,
    evalCases: ReadonlyArray<EvalCase>,
  ): Promise<number>;
}

export interface PromptMutatorPort {
  mutate(basePrompt: string, iteration: number): Promise<string>;
}

export interface OptimizePromptArgs {
  readonly basePrompt: string;
  readonly traces: ReadonlyArray<EvalCase>;
  readonly goldenSet: GoldenSet;
  readonly iterations: number;
  readonly evaluator: PromptEvaluatorPort;
  readonly mutator: PromptMutatorPort;
}

export interface OptimizePromptResult {
  readonly newPrompt: string;
  readonly goldenScore: number;
  readonly newTracesScore: number;
  readonly mutationsTried: number;
  readonly mutationsAccepted: number;
  readonly improved: boolean;
}

export type GepaOptimizeFn = (
  args: OptimizePromptArgs,
) => Promise<OptimizePromptResult>;

// ---------------------------------------------------------------------------
// Logger surface — matches `StageLogger` so the worker can pass its own.
// ---------------------------------------------------------------------------

export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Public surface.
// ---------------------------------------------------------------------------

export interface WeeklyCompileInput {
  readonly currentPrompt: string;
  readonly capability: string;
}

export interface WeeklyCompileOutput {
  readonly bestPrompt: string;
  readonly improvementScore: number;
  readonly iterations: number;
  readonly cleared: string;
}

export interface WeeklyPromptCompiler {
  compile(args: WeeklyCompileInput): Promise<WeeklyCompileOutput>;
}

export interface WeeklyPromptCompilerDeps {
  readonly mutator: ClaudeMutator;
  readonly evaluator: HaikuEvaluator;
  readonly optimize: GepaOptimizeFn;
  readonly goldenSet: GoldenSet;
  readonly logger?: Logger;
  /**
   * Hard cap on GEPA iterations per capability. Default 5 — see header.
   * Bounded at [1, 20] so misconfiguration can't burn through budget.
   */
  readonly maxIterations?: number;
  /**
   * How many candidate variants the Claude mutator emits per iteration.
   * Default 3.
   */
  readonly mutationCount?: number;
}

const DEFAULT_MAX_ITERATIONS = 5;
const MAX_ITERATIONS_CAP = 20;
const DEFAULT_MUTATION_COUNT = 3;

export function createWeeklyPromptCompiler(
  deps: WeeklyPromptCompilerDeps,
): WeeklyPromptCompiler {
  const maxIterations = clampIterations(
    deps.maxIterations ?? DEFAULT_MAX_ITERATIONS,
  );
  const mutationCount = Math.max(1, deps.mutationCount ?? DEFAULT_MUTATION_COUNT);

  return {
    async compile(args) {
      const basePrompt = (args.currentPrompt ?? '').trim();
      if (!basePrompt) {
        deps.logger?.warn(
          { compiler: 'weekly-prompt', capability: args.capability },
          'weekly-compiler: empty basePrompt — skipping',
        );
        return {
          bestPrompt: '',
          improvementScore: 0,
          iterations: 0,
          cleared: deps.goldenSet.version,
        };
      }

      const capabilityCases = deps.goldenSet.cases.filter(
        (c) => c.capability === args.capability,
      );
      if (capabilityCases.length === 0) {
        deps.logger?.warn(
          {
            compiler: 'weekly-prompt',
            capability: args.capability,
            goldenSetVersion: deps.goldenSet.version,
          },
          'weekly-compiler: no golden cases for capability — skipping',
        );
        return {
          bestPrompt: basePrompt,
          improvementScore: 0,
          iterations: 0,
          cleared: deps.goldenSet.version,
        };
      }

      // Track which case to focus the mutator on, rotating through
      // failures iteration-by-iteration. The mutator emits N variants
      // per call; the GEPA loop picks the first that passes its gate.
      const variantBuffer: string[] = [];
      let mutatorCalls = 0;

      const portMutator: PromptMutatorPort = {
        mutate: async (basePromptArg, iteration) => {
          if (variantBuffer.length > 0) {
            return variantBuffer.shift() ?? basePromptArg;
          }
          const targetCase =
            capabilityCases[iteration % capabilityCases.length] ??
            capabilityCases[0];
          if (!targetCase) return basePromptArg;
          mutatorCalls += 1;
          const variants = await deps.mutator.mutate({
            currentPrompt: basePromptArg,
            failureCase: targetCase as GoldenCase,
            capability: args.capability,
            mutationCount,
          });
          for (const v of variants) {
            const trimmed = v.trim();
            if (trimmed && trimmed !== basePromptArg) variantBuffer.push(trimmed);
          }
          return variantBuffer.shift() ?? basePromptArg;
        },
      };

      const portEvaluator: PromptEvaluatorPort = {
        evaluate: async (prompt, evalCases) => {
          if (evalCases.length === 0) return 0;
          let total = 0;
          for (const c of evalCases) {
            const r = await deps.evaluator.score({
              candidatePrompt: prompt,
              goldenCase: c as GoldenCase,
              expectedOutput: c.expectedOutput,
            });
            total += r.score;
          }
          return total / evalCases.length;
        },
      };

      let result: OptimizePromptResult;
      try {
        result = await deps.optimize({
          basePrompt,
          traces: capabilityCases,
          goldenSet: deps.goldenSet,
          iterations: maxIterations,
          evaluator: portEvaluator,
          mutator: portMutator,
        });
      } catch (error) {
        deps.logger?.warn(
          {
            compiler: 'weekly-prompt',
            capability: args.capability,
            goldenSetVersion: deps.goldenSet.version,
            err: error instanceof Error ? error.message : String(error),
          },
          'weekly-compiler: GEPA optimise threw — returning baseline',
        );
        return {
          bestPrompt: basePrompt,
          improvementScore: 0,
          iterations: 0,
          cleared: deps.goldenSet.version,
        };
      }

      const baselineScore = await portEvaluator.evaluate(
        basePrompt,
        capabilityCases,
      );
      const improvement = clampUnit(result.goldenScore - baselineScore);

      deps.logger?.info(
        {
          compiler: 'weekly-prompt',
          capability: args.capability,
          goldenSetVersion: deps.goldenSet.version,
          mutationsTried: result.mutationsTried,
          mutationsAccepted: result.mutationsAccepted,
          mutatorCalls,
          improved: result.improved,
          improvementScore: improvement,
        },
        'weekly-compiler: capability compile complete',
      );

      return {
        bestPrompt: result.improved ? result.newPrompt : basePrompt,
        improvementScore: result.improved ? improvement : 0,
        iterations: result.mutationsTried,
        cleared: deps.goldenSet.version,
      };
    },
  };
}

function clampIterations(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(Math.floor(n), MAX_ITERATIONS_CAP);
}

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
