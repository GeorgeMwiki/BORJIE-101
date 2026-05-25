/**
 * GEPA prompt-optimiser unit tests.
 *
 * Coverage (8+):
 *   1. base case returns the input prompt when no mutation improves
 *   2. promotes the first Pareto-improving mutation
 *   3. rejects a mutation that regresses on the golden set
 *   4. rejects a mutation that ties on the new-traces eval (strict >)
 *   5. mutationsTried counts deduplicated candidates only
 *   6. iterations is clamped (does NOT run unbounded)
 *   7. degrades when traces is empty (still ranks against golden only)
 *   8. throws when basePrompt is empty
 *   9. createDefaultMutator produces deterministic outputs for the same seed
 *   10. createExactMatchEvaluator scores 1.0 on a passing case
 */

import { describe, it, expect } from 'vitest';
import {
  optimizePrompt,
  createDefaultMutator,
  createExactMatchEvaluator,
  type PromptEvaluator,
  type PromptMutator,
} from '../gepa-optimizer.js';
import { createFrozenGoldenSet, type EvalCase } from '../golden-set.js';

const golden = createFrozenGoldenSet([
  {
    id: 'g-1',
    input: 'q1',
    expectedOutput: 'a1',
    capability: 'cap-1',
  },
  {
    id: 'g-2',
    input: 'q2',
    expectedOutput: 'a2',
    capability: 'cap-2',
  },
]);

const traces: ReadonlyArray<EvalCase> = [
  { id: 't-1', input: 'x', expectedOutput: 'X', capability: 'cap-1' },
  { id: 't-2', input: 'y', expectedOutput: 'Y', capability: 'cap-2' },
];

// Build an evaluator that scores by table lookup (prompt → fixed score).
function scriptedEvaluator(table: {
  golden: Record<string, number>;
  newTraces: Record<string, number>;
}): PromptEvaluator {
  return {
    async evaluate(prompt, evalCases) {
      const goldenIds = new Set(['g-1', 'g-2']);
      const isGolden = evalCases.every((c) => goldenIds.has(c.id));
      const map = isGolden ? table.golden : table.newTraces;
      const key = prompt in map ? prompt : 'base';
      return map[key] ?? 0;
    },
  };
}

function fixedMutator(sequence: ReadonlyArray<string>): PromptMutator {
  let idx = 0;
  return {
    async mutate() {
      const out = sequence[idx % sequence.length] ?? '';
      idx += 1;
      return out;
    },
  };
}

describe('optimizePrompt', () => {
  it('returns the base prompt when no mutation improves', async () => {
    const evaluator = scriptedEvaluator({
      golden: { base: 0.5, 'mutated-1': 0.5 },
      newTraces: { base: 0.5, 'mutated-1': 0.4 }, // worse
    });
    const out = await optimizePrompt({
      basePrompt: 'base',
      traces,
      goldenSet: golden,
      iterations: 3,
      evaluator,
      mutator: fixedMutator(['mutated-1']),
    });
    expect(out.newPrompt).toBe('base');
    expect(out.improved).toBe(false);
  });

  it('promotes the first Pareto-improving mutation', async () => {
    const evaluator = scriptedEvaluator({
      golden: { base: 0.5, 'mutated-good': 0.7 },
      newTraces: { base: 0.5, 'mutated-good': 0.8 },
    });
    const out = await optimizePrompt({
      basePrompt: 'base',
      traces,
      goldenSet: golden,
      iterations: 2,
      evaluator,
      mutator: fixedMutator(['mutated-good']),
    });
    expect(out.newPrompt).toBe('mutated-good');
    expect(out.improved).toBe(true);
    expect(out.goldenScore).toBe(0.7);
    expect(out.newTracesScore).toBe(0.8);
  });

  it('rejects a mutation that regresses on the golden set', async () => {
    const evaluator = scriptedEvaluator({
      golden: { base: 0.7, 'mutated-bad': 0.5 }, // regresses
      newTraces: { base: 0.5, 'mutated-bad': 0.9 }, // ↑ on traces, but moot
    });
    const out = await optimizePrompt({
      basePrompt: 'base',
      traces,
      goldenSet: golden,
      iterations: 3,
      evaluator,
      mutator: fixedMutator(['mutated-bad']),
    });
    expect(out.newPrompt).toBe('base');
    expect(out.improved).toBe(false);
  });

  it('rejects a mutation that ties on the new-traces eval (strict >)', async () => {
    const evaluator = scriptedEvaluator({
      golden: { base: 0.5, 'mutated-tie': 0.6 }, // strictly better on golden
      newTraces: { base: 0.5, 'mutated-tie': 0.5 }, // tie on new
    });
    const out = await optimizePrompt({
      basePrompt: 'base',
      traces,
      goldenSet: golden,
      iterations: 3,
      evaluator,
      mutator: fixedMutator(['mutated-tie']),
    });
    expect(out.improved).toBe(false);
  });

  it('mutationsTried counts deduplicated candidates only', async () => {
    const evaluator = scriptedEvaluator({
      golden: { base: 0.5, dup: 0.4 },
      newTraces: { base: 0.5, dup: 0.4 },
    });
    const out = await optimizePrompt({
      basePrompt: 'base',
      traces,
      goldenSet: golden,
      iterations: 5,
      evaluator,
      mutator: fixedMutator(['dup', 'dup', 'dup']), // duplicates
    });
    expect(out.mutationsTried).toBe(1);
  });

  it('clamps iterations to a hard cap (does not run unbounded)', async () => {
    let calls = 0;
    const counter: PromptMutator = {
      async mutate() {
        calls += 1;
        return `m-${calls}`;
      },
    };
    const evaluator: PromptEvaluator = {
      async evaluate() {
        return 0;
      },
    };
    await optimizePrompt({
      basePrompt: 'base',
      traces: [],
      goldenSet: golden,
      iterations: 10_000, // way over cap
      evaluator,
      mutator: counter,
    });
    expect(calls).toBeLessThanOrEqual(100);
  });

  it('degrades when traces is empty (golden-only ranking)', async () => {
    const evaluator = scriptedEvaluator({
      golden: { base: 0.5, 'mutated-good': 0.8 },
      newTraces: {},
    });
    const out = await optimizePrompt({
      basePrompt: 'base',
      traces: [],
      goldenSet: golden,
      iterations: 2,
      evaluator,
      mutator: fixedMutator(['mutated-good']),
    });
    expect(out.newPrompt).toBe('mutated-good');
    expect(out.newTracesScore).toBe(0);
  });

  it('throws when basePrompt is empty', async () => {
    const evaluator: PromptEvaluator = {
      async evaluate() {
        return 0;
      },
    };
    await expect(
      optimizePrompt({
        basePrompt: '',
        traces,
        goldenSet: golden,
        iterations: 1,
        evaluator,
        mutator: fixedMutator(['m1']),
      }),
    ).rejects.toThrow();
  });

  it('createDefaultMutator is deterministic for the same seed', async () => {
    const m1 = createDefaultMutator({ seed: 0 });
    const m2 = createDefaultMutator({ seed: 0 });
    const out1 = await m1.mutate('Test prompt.', 0);
    const out2 = await m2.mutate('Test prompt.', 0);
    expect(out1).toBe(out2);
  });

  it('createExactMatchEvaluator scores 1.0 on a passing case', async () => {
    const evaluator = createExactMatchEvaluator({
      async run() {
        return 'a1';
      },
    });
    const score = await evaluator.evaluate('prompt', [
      {
        id: 'g-1',
        input: 'q',
        expectedOutput: 'a1',
        capability: 'cap',
      },
    ]);
    expect(score).toBe(1);
  });
});
