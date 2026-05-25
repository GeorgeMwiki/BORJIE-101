/**
 * Stage 09 — weekly prompt-compile unit tests.
 *
 * Coverage:
 *   1. legacy `compile()` callback path still works (back-compat with
 *      the orchestrator wiring as of Phase B)
 *   2. real compiler path runs once per unique capability in the golden set
 *   3. real compiler path promotes only when improvementScore meets threshold
 *   4. wiring without goldenSet/loader skips with algorithm=skipped-no-compiler
 *   5. neither compile nor weeklyPromptCompiler → skips with algorithm=skipped-no-compiler
 *   6. promotedSink failure does not abort other capabilities
 *   7. promptLoader returning null is logged + skipped
 *   8. compiler throw for one capability does not stop the loop
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runWeeklyPromptCompileStage,
  type CurrentPromptLoader,
  type PromotedPromptSink,
} from '../../stages/09-weekly-prompt-compile.js';
import type {
  GoldenSet,
  WeeklyPromptCompiler,
} from '../../prompt-compile/weekly-compiler.js';
import type { StageLogger } from '../../stages/types.js';

function makeLogger(): StageLogger & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeGoldenSet(): GoldenSet {
  return {
    cases: [
      { id: 'a-1', input: 'i', expectedOutput: 'o', capability: 'cap-a' },
      { id: 'a-2', input: 'i', expectedOutput: 'o', capability: 'cap-a' },
      { id: 'b-1', input: 'i', expectedOutput: 'o', capability: 'cap-b' },
    ],
    version: 'sha256-fixture-v1',
    frozenAt: '2026-01-01T00:00:00.000Z',
  };
}

function loaderFrom(map: Record<string, string | null>): CurrentPromptLoader {
  return { load: async (capability) => map[capability] ?? null };
}

function recordingSink(): PromotedPromptSink & {
  calls: Array<{
    capability: string;
    newPrompt: string;
    improvementScore: number;
    clearedGoldenSetVersion: string;
  }>;
} {
  const calls: PromotedPromptSink extends { promote: (a: infer A) => unknown }
    ? A[]
    : never = [] as never;
  return {
    calls,
    promote: async (args) => {
      (calls as Array<typeof args>).push(args);
    },
  };
}

describe('runWeeklyPromptCompileStage', () => {
  it('legacy compile() path still works (orchestrator back-compat)', async () => {
    const logger = makeLogger();
    const compile = vi.fn(async () => ({
      promptsCompiled: 4,
      promotedCount: 1,
    }));
    const out = await runWeeklyPromptCompileStage({ logger, compile });
    expect(out.promptsCompiled).toBe(4);
    expect(out.promotedCount).toBe(1);
    expect(compile).toHaveBeenCalledOnce();
  });

  it('real compiler runs once per unique capability', async () => {
    const logger = makeLogger();
    const goldenSet = makeGoldenSet();
    const compile = vi.fn(async (args: { capability: string }) => ({
      bestPrompt: `improved-${args.capability}`,
      improvementScore: 0.5,
      iterations: 2,
      cleared: goldenSet.version,
    }));
    const compiler: WeeklyPromptCompiler = { compile };
    const sink = recordingSink();
    const out = await runWeeklyPromptCompileStage({
      logger,
      weeklyPromptCompiler: compiler,
      goldenSet,
      promptLoader: loaderFrom({
        'cap-a': 'base-a',
        'cap-b': 'base-b',
      }),
      promotedSink: sink,
    });
    expect(compile).toHaveBeenCalledTimes(2);
    expect(out.promptsCompiled).toBe(2);
    expect(out.promotedCount).toBe(2);
    expect(out.perCapability).toHaveLength(2);
    expect(sink.calls.map((c) => c.capability).sort()).toEqual([
      'cap-a',
      'cap-b',
    ]);
  });

  it('promotes only when improvementScore meets threshold', async () => {
    const logger = makeLogger();
    const goldenSet = makeGoldenSet();
    const compile = vi.fn(async (args: { capability: string }) => ({
      bestPrompt: `improved-${args.capability}`,
      improvementScore: args.capability === 'cap-a' ? 0.5 : 0.001,
      iterations: 1,
      cleared: goldenSet.version,
    }));
    const compiler: WeeklyPromptCompiler = { compile };
    const sink = recordingSink();
    const out = await runWeeklyPromptCompileStage({
      logger,
      weeklyPromptCompiler: compiler,
      goldenSet,
      promptLoader: loaderFrom({
        'cap-a': 'base-a',
        'cap-b': 'base-b',
      }),
      promotedSink: sink,
      minImprovementForPromotion: 0.01,
    });
    expect(out.promotedCount).toBe(1);
    expect(sink.calls.map((c) => c.capability)).toEqual(['cap-a']);
  });

  it('skips with algorithm=skipped-no-compiler when goldenSet missing', async () => {
    const logger = makeLogger();
    const compile = vi.fn();
    const compiler: WeeklyPromptCompiler = { compile };
    const out = await runWeeklyPromptCompileStage({
      logger,
      weeklyPromptCompiler: compiler,
    });
    expect(out.promptsCompiled).toBe(0);
    expect(compile).not.toHaveBeenCalled();
    const warn = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(warn).toMatchObject({ algorithm: 'skipped-no-compiler' });
  });

  it('skips with algorithm=skipped-no-compiler when neither compile nor weeklyPromptCompiler', async () => {
    const logger = makeLogger();
    const out = await runWeeklyPromptCompileStage({ logger });
    expect(out.promptsCompiled).toBe(0);
    const warn = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(warn).toMatchObject({ algorithm: 'skipped-no-compiler' });
  });

  it('promotedSink failure does not abort other capabilities', async () => {
    const logger = makeLogger();
    const goldenSet = makeGoldenSet();
    const compile = vi.fn(async (args: { capability: string }) => ({
      bestPrompt: `improved-${args.capability}`,
      improvementScore: 0.5,
      iterations: 1,
      cleared: goldenSet.version,
    }));
    const compiler: WeeklyPromptCompiler = { compile };
    let calls = 0;
    const sink: PromotedPromptSink = {
      async promote() {
        calls += 1;
        if (calls === 1) throw new Error('sink boom');
      },
    };
    const out = await runWeeklyPromptCompileStage({
      logger,
      weeklyPromptCompiler: compiler,
      goldenSet,
      promptLoader: loaderFrom({ 'cap-a': 'a', 'cap-b': 'b' }),
      promotedSink: sink,
    });
    expect(out.promptsCompiled).toBe(2);
    // Only the second sink call succeeded.
    expect(out.promotedCount).toBe(1);
  });

  it('promptLoader returning null logs warn and skips capability', async () => {
    const logger = makeLogger();
    const goldenSet = makeGoldenSet();
    const compile = vi.fn(async (args: { capability: string }) => ({
      bestPrompt: `improved-${args.capability}`,
      improvementScore: 0.5,
      iterations: 1,
      cleared: goldenSet.version,
    }));
    const compiler: WeeklyPromptCompiler = { compile };
    const out = await runWeeklyPromptCompileStage({
      logger,
      weeklyPromptCompiler: compiler,
      goldenSet,
      promptLoader: loaderFrom({ 'cap-a': 'a', 'cap-b': null }),
    });
    expect(compile).toHaveBeenCalledTimes(1);
    expect(out.promptsCompiled).toBe(1);
    expect((logger.warn as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      0,
    );
  });

  it('compiler throw for one capability does not stop the loop', async () => {
    const logger = makeLogger();
    const goldenSet = makeGoldenSet();
    const compile = vi.fn(async (args: { capability: string }) => {
      if (args.capability === 'cap-a') throw new Error('compile boom');
      return {
        bestPrompt: 'improved-b',
        improvementScore: 0.3,
        iterations: 1,
        cleared: goldenSet.version,
      };
    });
    const compiler: WeeklyPromptCompiler = { compile };
    const out = await runWeeklyPromptCompileStage({
      logger,
      weeklyPromptCompiler: compiler,
      goldenSet,
      promptLoader: loaderFrom({ 'cap-a': 'a', 'cap-b': 'b' }),
    });
    expect(out.promptsCompiled).toBe(1);
    expect(out.perCapability?.[0]?.capability).toBe('cap-b');
  });
});
