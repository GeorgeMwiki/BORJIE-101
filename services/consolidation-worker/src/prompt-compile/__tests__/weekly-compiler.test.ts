/**
 * weekly-compiler — unit tests.
 *
 * The test wires a faithful port of B4's `optimizePrompt` (kept inline
 * here so the worker has no compile-time dep on
 * `@borjie/central-intelligence`; the production composition root
 * passes the real function in). The port mirrors the Pareto-improvement
 * gate verbatim — same algorithm, same accept-criteria.
 *
 * Coverage:
 *   1. returns baseline when mutator never improves
 *   2. promotes improved prompt when both gates pass
 *   3. Pareto-gate rejects regression on golden set
 *   4. Pareto-gate rejects equal-or-worse new-traces score
 *   5. maxIterations is capped at 20
 *   6. maxIterations floor (0 → 1)
 *   7. empty currentPrompt → empty output, no compile call
 *   8. capability with no golden cases → baseline returned + log warn
 *   9. optimize-throw path → baseline returned + log warn
 *   10. improvementScore is clamped to [0, 1]
 *   11. cleared = goldenSet.version on every call
 *   12. logger.info fires with goldenSetVersion + improvementScore
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createWeeklyPromptCompiler,
  type GepaOptimizeFn,
  type GoldenSet,
  type OptimizePromptArgs,
  type OptimizePromptResult,
} from '../weekly-compiler.js';
import type { ClaudeMutator } from '../claude-mutator.js';
import type { HaikuEvaluator } from '../haiku-evaluator.js';

// ─────────────────────────────────────────────────────────────────────
// Faithful port of B4's `optimizePrompt` (gepa-optimizer.ts).
// Same algorithm — Pareto gate on golden set + strict improvement on
// new-trace eval. Used as the "real GEPA" the spec asks for.
// ─────────────────────────────────────────────────────────────────────

async function realGepaPort(
  args: OptimizePromptArgs,
): Promise<OptimizePromptResult> {
  const base = (args.basePrompt ?? '').trim();
  if (!base) throw new Error('basePrompt required');
  const iterations = Math.min(Math.floor(args.iterations), 100);

  let bestPrompt = base;
  let bestGolden = await args.evaluator.evaluate(bestPrompt, args.goldenSet.cases);
  let bestNew =
    args.traces.length > 0
      ? await args.evaluator.evaluate(bestPrompt, args.traces)
      : 0;

  const seen = new Set<string>([base]);
  let mutationsTried = 0;
  let mutationsAccepted = 0;

  for (let i = 0; i < iterations; i += 1) {
    const cand = (await args.mutator.mutate(bestPrompt, i)).trim();
    if (!cand || seen.has(cand)) continue;
    seen.add(cand);
    mutationsTried += 1;

    const gold = await args.evaluator.evaluate(cand, args.goldenSet.cases);
    if (gold < bestGolden) continue;

    const fresh =
      args.traces.length > 0
        ? await args.evaluator.evaluate(cand, args.traces)
        : 0;
    if (args.traces.length > 0 && fresh <= bestNew) continue;

    bestPrompt = cand;
    bestGolden = gold;
    bestNew = fresh;
    mutationsAccepted += 1;
  }

  return {
    newPrompt: bestPrompt,
    goldenScore: bestGolden,
    newTracesScore: bestNew,
    mutationsTried,
    mutationsAccepted,
    improved: bestPrompt !== base,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────

function makeGoldenSet(cases?: GoldenSet['cases']): GoldenSet {
  return {
    cases:
      cases ?? [
        {
          id: 'late-rent-sw-1',
          input: 'kumbusha Juma',
          expectedOutput: 'Habari Juma',
          capability: 'late-rent-reminder',
        },
        {
          id: 'late-rent-sw-2',
          input: 'kumbusha Asha',
          expectedOutput: 'Habari Asha',
          capability: 'late-rent-reminder',
        },
      ],
    version: 'sha256-test-fixture',
    frozenAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Mutator that returns the same identity prompt — no improvement. */
function identityMutator(): ClaudeMutator {
  return {
    async mutate({ currentPrompt }) {
      return [currentPrompt];
    },
  };
}

/** Mutator that returns improved variants tagged with iteration number. */
function improvingMutator(): ClaudeMutator {
  let i = 0;
  return {
    async mutate({ currentPrompt }) {
      i += 1;
      return [`${currentPrompt}\n[improved v${i}]`];
    },
  };
}

/** Evaluator that scores higher when prompt contains "[improved". */
function improvementSensingEvaluator(): HaikuEvaluator {
  return {
    async score({ candidatePrompt }) {
      const score = candidatePrompt.includes('[improved') ? 0.9 : 0.5;
      return { score, reasoning: 'test' };
    },
  };
}

/** Evaluator that gives a fixed score regardless of input. */
function constantEvaluator(score: number): HaikuEvaluator {
  return {
    async score() {
      return { score, reasoning: 'const' };
    },
  };
}

/** Evaluator that REGRESSES on the goldenSet for any new candidate. */
function regressingEvaluator(): HaikuEvaluator {
  return {
    async score({ candidatePrompt }) {
      const score = candidatePrompt.includes('[improved') ? 0.2 : 0.8;
      return { score, reasoning: 'regress' };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('createWeeklyPromptCompiler', () => {
  it('returns baseline when mutator never produces new variants', async () => {
    const compiler = createWeeklyPromptCompiler({
      mutator: identityMutator(),
      evaluator: constantEvaluator(0.6),
      optimize: realGepaPort,
      goldenSet: makeGoldenSet(),
      logger: makeLogger(),
    });
    const out = await compiler.compile({
      currentPrompt: 'Base reminder prompt.',
      capability: 'late-rent-reminder',
    });
    expect(out.bestPrompt).toBe('Base reminder prompt.');
    expect(out.improvementScore).toBe(0);
  });

  it('promotes the improved candidate when both Pareto gates pass', async () => {
    const compiler = createWeeklyPromptCompiler({
      mutator: improvingMutator(),
      evaluator: improvementSensingEvaluator(),
      optimize: realGepaPort,
      goldenSet: makeGoldenSet(),
      logger: makeLogger(),
      maxIterations: 3,
    });
    const out = await compiler.compile({
      currentPrompt: 'Base reminder prompt.',
      capability: 'late-rent-reminder',
    });
    expect(out.bestPrompt).toContain('[improved');
    expect(out.improvementScore).toBeGreaterThan(0);
  });

  it('Pareto gate rejects regression on the golden set', async () => {
    const compiler = createWeeklyPromptCompiler({
      mutator: improvingMutator(),
      evaluator: regressingEvaluator(),
      optimize: realGepaPort,
      goldenSet: makeGoldenSet(),
      logger: makeLogger(),
      maxIterations: 3,
    });
    const out = await compiler.compile({
      currentPrompt: 'Base reminder.',
      capability: 'late-rent-reminder',
    });
    expect(out.bestPrompt).toBe('Base reminder.');
    expect(out.improvementScore).toBe(0);
  });

  it('Pareto gate rejects equal-score on new traces', async () => {
    // Always-0.6 evaluator means newTraces score never strictly improves.
    const compiler = createWeeklyPromptCompiler({
      mutator: improvingMutator(),
      evaluator: constantEvaluator(0.6),
      optimize: realGepaPort,
      goldenSet: makeGoldenSet(),
      logger: makeLogger(),
      maxIterations: 3,
    });
    const out = await compiler.compile({
      currentPrompt: 'Base.',
      capability: 'late-rent-reminder',
    });
    expect(out.bestPrompt).toBe('Base.');
  });

  it('caps maxIterations at 20', async () => {
    const captured: number[] = [];
    const observingOptimize: GepaOptimizeFn = async (args) => {
      captured.push(args.iterations);
      return realGepaPort(args);
    };
    const compiler = createWeeklyPromptCompiler({
      mutator: identityMutator(),
      evaluator: constantEvaluator(0.5),
      optimize: observingOptimize,
      goldenSet: makeGoldenSet(),
      logger: makeLogger(),
      maxIterations: 9999,
    });
    await compiler.compile({
      currentPrompt: 'X.',
      capability: 'late-rent-reminder',
    });
    expect(captured[0]).toBe(20);
  });

  it('floors maxIterations <= 0 to 1', async () => {
    const captured: number[] = [];
    const observingOptimize: GepaOptimizeFn = async (args) => {
      captured.push(args.iterations);
      return realGepaPort(args);
    };
    const compiler = createWeeklyPromptCompiler({
      mutator: identityMutator(),
      evaluator: constantEvaluator(0.5),
      optimize: observingOptimize,
      goldenSet: makeGoldenSet(),
      logger: makeLogger(),
      maxIterations: 0,
    });
    await compiler.compile({
      currentPrompt: 'X.',
      capability: 'late-rent-reminder',
    });
    expect(captured[0]).toBe(1);
  });

  it('empty currentPrompt → empty output and no optimize call', async () => {
    const optimize = vi.fn();
    const compiler = createWeeklyPromptCompiler({
      mutator: identityMutator(),
      evaluator: constantEvaluator(0.5),
      optimize: optimize as unknown as GepaOptimizeFn,
      goldenSet: makeGoldenSet(),
      logger: makeLogger(),
    });
    const out = await compiler.compile({
      currentPrompt: '   ',
      capability: 'late-rent-reminder',
    });
    expect(out.bestPrompt).toBe('');
    expect(optimize).not.toHaveBeenCalled();
  });

  it('capability with no golden cases returns baseline + warn log', async () => {
    const logger = makeLogger();
    const compiler = createWeeklyPromptCompiler({
      mutator: identityMutator(),
      evaluator: constantEvaluator(0.5),
      optimize: realGepaPort,
      goldenSet: makeGoldenSet(),
      logger,
    });
    const out = await compiler.compile({
      currentPrompt: 'Base.',
      capability: 'unknown-capability',
    });
    expect(out.bestPrompt).toBe('Base.');
    expect(out.improvementScore).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns baseline + warn when optimize throws', async () => {
    const logger = makeLogger();
    const optimize: GepaOptimizeFn = async () => {
      throw new Error('GEPA exploded');
    };
    const compiler = createWeeklyPromptCompiler({
      mutator: identityMutator(),
      evaluator: constantEvaluator(0.5),
      optimize,
      goldenSet: makeGoldenSet(),
      logger,
    });
    const out = await compiler.compile({
      currentPrompt: 'Base.',
      capability: 'late-rent-reminder',
    });
    expect(out.bestPrompt).toBe('Base.');
    expect(out.improvementScore).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('improvementScore is clamped to [0, 1]', async () => {
    // Evaluator that says new is 1.0 and baseline is 0.0 → delta 1.0 stays 1.
    const evaluator: HaikuEvaluator = {
      async score({ candidatePrompt }) {
        return {
          score: candidatePrompt.includes('[improved') ? 1.0 : 0.0,
          reasoning: 't',
        };
      },
    };
    const compiler = createWeeklyPromptCompiler({
      mutator: improvingMutator(),
      evaluator,
      optimize: realGepaPort,
      goldenSet: makeGoldenSet(),
      logger: makeLogger(),
      maxIterations: 2,
    });
    const out = await compiler.compile({
      currentPrompt: 'Base.',
      capability: 'late-rent-reminder',
    });
    expect(out.improvementScore).toBeLessThanOrEqual(1);
    expect(out.improvementScore).toBeGreaterThanOrEqual(0);
  });

  it('cleared field always equals goldenSet.version', async () => {
    const gs = makeGoldenSet();
    const compiler = createWeeklyPromptCompiler({
      mutator: identityMutator(),
      evaluator: constantEvaluator(0.5),
      optimize: realGepaPort,
      goldenSet: gs,
      logger: makeLogger(),
    });
    const a = await compiler.compile({
      currentPrompt: 'A.',
      capability: 'late-rent-reminder',
    });
    const b = await compiler.compile({
      currentPrompt: '',
      capability: 'late-rent-reminder',
    });
    const c = await compiler.compile({
      currentPrompt: 'C.',
      capability: 'no-such-cap',
    });
    expect(a.cleared).toBe(gs.version);
    expect(b.cleared).toBe(gs.version);
    expect(c.cleared).toBe(gs.version);
  });

  it('logger.info carries goldenSetVersion + improvementScore on success path', async () => {
    const logger = makeLogger();
    const compiler = createWeeklyPromptCompiler({
      mutator: improvingMutator(),
      evaluator: improvementSensingEvaluator(),
      optimize: realGepaPort,
      goldenSet: makeGoldenSet(),
      logger,
      maxIterations: 2,
    });
    await compiler.compile({
      currentPrompt: 'Base.',
      capability: 'late-rent-reminder',
    });
    const calls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const first = calls[0]?.[0] as Record<string, unknown>;
    expect(first.goldenSetVersion).toBe('sha256-test-fixture');
    expect(typeof first.improvementScore).toBe('number');
  });
});
