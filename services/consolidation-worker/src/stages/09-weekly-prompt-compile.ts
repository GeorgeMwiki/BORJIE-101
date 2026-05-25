/**
 * Stage 09 — Weekly prompt recompile (DSPy GEPA-style).
 *
 * B4 Phase B — Progressive Intelligence.
 *
 * Runs ONCE PER WEEK, on Sundays (UTC), from the orchestrator. Picks
 * up the `prompt-patch` decisions emitted by stage 04 over the past
 * week, runs GEPA Pareto-improvement against the frozen golden set
 * and the new-trace eval suite, and promotes new prompts only when:
 *
 *   1. The new prompt scores ≥ the base prompt on the golden set
 *      (golden set is FROZEN — no regressions allowed).
 *   2. The new prompt scores STRICTLY > the base prompt on the new
 *      trace suite.
 *
 * The DSPy GEPA engine lives in `@borjie/central-intelligence`
 * (`kernel/prompt-evolution/gepa-optimizer.ts`); this stage is a thin
 * port wrapper so the worker has no compile-time dependency on the
 * optimiser package.
 *
 * Why a separate stage instead of running every night?
 * Per the architecture doc, weekly cadence is what DSPy GEPA was
 * tuned against; running it nightly produces noisy mutations and
 * wastes spend. The orchestrator's `weekday()` guard short-circuits
 * on non-Sunday ticks.
 */

import type { StageLogger } from './types.js';
import type {
  WeeklyPromptCompiler,
  GoldenSet,
} from '../prompt-compile/weekly-compiler.js';

export interface WeeklyPromptCompileResult {
  readonly promptsCompiled: number;
  readonly promotedCount: number;
  /**
   * Per-capability compile detail, populated when the real compiler is
   * wired. Empty array when the stage runs in legacy `compile()` mode.
   */
  readonly perCapability?: ReadonlyArray<{
    readonly capability: string;
    readonly improved: boolean;
    readonly improvementScore: number;
    readonly iterations: number;
  }>;
}

/**
 * Capability → current-prompt loader. Stage 09 calls this once per
 * capability tag found in the golden set. The composition root wires a
 * real prompt-registry adapter; tests pass a static map.
 */
export interface CurrentPromptLoader {
  load(capability: string): Promise<string | null>;
}

/**
 * Promotion sink. Receives the (capability, newPrompt, improvement)
 * tuple when the compiler returns an improved variant. The composition
 * root wires a real prompt-registry writer; tests pass a recorder.
 */
export interface PromotedPromptSink {
  promote(args: {
    readonly capability: string;
    readonly newPrompt: string;
    readonly improvementScore: number;
    readonly clearedGoldenSetVersion: string;
  }): Promise<void>;
}

export interface WeeklyPromptCompileArgs {
  readonly logger: StageLogger;
  /**
   * Legacy entry point — kept for back-compat with composition roots
   * that wire a one-shot stage callable. Used when `weeklyPromptCompiler`
   * is NOT supplied. Either this or `weeklyPromptCompiler` must be set.
   */
  readonly compile?: () => Promise<WeeklyPromptCompileResult>;
  /**
   * Real compiler wired by Phase C (C7). When supplied, the stage
   * iterates over every capability in the golden set and asks the
   * compiler to improve the current prompt for that capability.
   */
  readonly weeklyPromptCompiler?: WeeklyPromptCompiler;
  /** Required when `weeklyPromptCompiler` is supplied. */
  readonly goldenSet?: GoldenSet;
  /** Required when `weeklyPromptCompiler` is supplied. */
  readonly promptLoader?: CurrentPromptLoader;
  /** Optional — only successful improvements call `promote`. */
  readonly promotedSink?: PromotedPromptSink;
  /**
   * Minimum improvement score required to fire `promotedSink.promote`.
   * Default 0.01 — anything smaller is statistical noise.
   */
  readonly minImprovementForPromotion?: number;
}

export async function runWeeklyPromptCompileStage(
  args: WeeklyPromptCompileArgs,
): Promise<WeeklyPromptCompileResult> {
  // ── Real-compiler path ───────────────────────────────────────────────
  if (args.weeklyPromptCompiler) {
    if (!args.goldenSet || !args.promptLoader) {
      args.logger.warn(
        {
          stage: '09-weekly-prompt-compile',
          algorithm: 'skipped-no-compiler',
          reason: 'weeklyPromptCompiler wired without goldenSet/promptLoader',
        },
        'weekly prompt-compile skipped',
      );
      return { promptsCompiled: 0, promotedCount: 0, perCapability: [] };
    }
    return runRealCompiler({
      logger: args.logger,
      compiler: args.weeklyPromptCompiler,
      goldenSet: args.goldenSet,
      promptLoader: args.promptLoader,
      ...(args.promotedSink ? { promotedSink: args.promotedSink } : {}),
      minImprovement: args.minImprovementForPromotion ?? 0.01,
    });
  }

  // ── Legacy path ──────────────────────────────────────────────────────
  if (!args.compile) {
    args.logger.warn(
      {
        stage: '09-weekly-prompt-compile',
        algorithm: 'skipped-no-compiler',
      },
      'weekly prompt-compile skipped — no compiler wired',
    );
    return { promptsCompiled: 0, promotedCount: 0 };
  }

  try {
    const result = await args.compile();
    args.logger.info(
      {
        stage: '09-weekly-prompt-compile',
        promptsCompiled: result.promptsCompiled,
        promotedCount: result.promotedCount,
      },
      'weekly prompt-compile complete',
    );
    return result;
  } catch (error) {
    args.logger.warn(
      {
        stage: '09-weekly-prompt-compile',
        err: error instanceof Error ? error.message : String(error),
      },
      'weekly prompt-compile failed',
    );
    return { promptsCompiled: 0, promotedCount: 0 };
  }
}

interface RealCompilerArgs {
  readonly logger: StageLogger;
  readonly compiler: WeeklyPromptCompiler;
  readonly goldenSet: GoldenSet;
  readonly promptLoader: CurrentPromptLoader;
  readonly promotedSink?: PromotedPromptSink;
  readonly minImprovement: number;
}

async function runRealCompiler(
  args: RealCompilerArgs,
): Promise<WeeklyPromptCompileResult> {
  const capabilities = uniqueCapabilities(args.goldenSet.cases);
  const perCapability: Array<{
    capability: string;
    improved: boolean;
    improvementScore: number;
    iterations: number;
  }> = [];
  let promptsCompiled = 0;
  let promotedCount = 0;

  for (const capability of capabilities) {
    let currentPrompt: string | null;
    try {
      currentPrompt = await args.promptLoader.load(capability);
    } catch (error) {
      args.logger.warn(
        {
          stage: '09-weekly-prompt-compile',
          capability,
          err: error instanceof Error ? error.message : String(error),
        },
        'prompt loader threw — skipping capability',
      );
      continue;
    }
    if (!currentPrompt || !currentPrompt.trim()) {
      args.logger.warn(
        {
          stage: '09-weekly-prompt-compile',
          capability,
        },
        'no current prompt for capability — skipping',
      );
      continue;
    }

    try {
      const outcome = await args.compiler.compile({
        currentPrompt,
        capability,
      });
      promptsCompiled += 1;
      const improved =
        outcome.bestPrompt !== currentPrompt &&
        outcome.improvementScore >= args.minImprovement;
      perCapability.push({
        capability,
        improved,
        improvementScore: outcome.improvementScore,
        iterations: outcome.iterations,
      });
      if (improved && args.promotedSink) {
        try {
          await args.promotedSink.promote({
            capability,
            newPrompt: outcome.bestPrompt,
            improvementScore: outcome.improvementScore,
            clearedGoldenSetVersion: outcome.cleared,
          });
          promotedCount += 1;
        } catch (error) {
          args.logger.warn(
            {
              stage: '09-weekly-prompt-compile',
              capability,
              err: error instanceof Error ? error.message : String(error),
            },
            'promotion sink threw — continuing',
          );
        }
      }
    } catch (error) {
      args.logger.warn(
        {
          stage: '09-weekly-prompt-compile',
          capability,
          err: error instanceof Error ? error.message : String(error),
        },
        'weekly compiler threw for capability — continuing',
      );
    }
  }

  args.logger.info(
    {
      stage: '09-weekly-prompt-compile',
      algorithm: 'gepa-claude-haiku',
      goldenSetVersion: args.goldenSet.version,
      capabilities: capabilities.length,
      promptsCompiled,
      promotedCount,
    },
    'weekly prompt-compile complete',
  );

  return { promptsCompiled, promotedCount, perCapability };
}

function uniqueCapabilities(
  cases: ReadonlyArray<{ capability: string }>,
): ReadonlyArray<string> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of cases) {
    if (!c.capability || seen.has(c.capability)) continue;
    seen.add(c.capability);
    out.push(c.capability);
  }
  return out;
}
