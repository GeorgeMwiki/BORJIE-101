import { describe, it, expect } from 'vitest';
import {
  searchPlan,
  heuristicEvaluator,
  cosineSimilarity,
  llmExpander,
  buildExpanderPrompt,
  DEFAULT_BRANCHING_FACTOR,
  DEFAULT_MAX_DEPTH,
  HARD_MAX_EXPANSIONS,
  ESTIMATED_TOKENS_PER_EXPANSION,
  type Evaluator,
  type Expander,
  type Thought,
} from '../search-planner.js';

// ─────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────

/**
 * Deterministic expander: returns `k` children whose content is
 * `${parent.content}/${i}` (so we can eyeball the tree).
 */
function fanOutExpander(): Expander {
  return async (parent, k) => {
    const out: Thought[] = [];
    for (let i = 0; i < k; i += 1) {
      out.push({
        id: 'temp',
        content: `${parent.content}/${i}`,
        depth: parent.depth + 1,
        parentId: parent.id,
        score: 0,
        explored: false,
      });
    }
    return out;
  };
}

/**
 * Evaluator that returns a fixed score per content. Any content not in
 * the map gets 0.5.
 */
function tableEvaluator(table: Record<string, number>): Evaluator {
  return async (t) => table[t.content] ?? 0.5;
}

/**
 * Counting evaluator — tells us how many times the evaluator ran.
 */
function countingEvaluator(): {
  evaluator: Evaluator;
  count: () => number;
} {
  let n = 0;
  const evaluator: Evaluator = async () => {
    n += 1;
    return 0.5;
  };
  return { evaluator, count: () => n };
}

/**
 * Counting expander — tracks expansions.
 */
function countingExpander(inner: Expander): {
  expander: Expander;
  count: () => number;
} {
  let n = 0;
  const expander: Expander = async (parent, k) => {
    n += 1;
    return inner(parent, k);
  };
  return { expander, count: () => n };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('searchPlan', () => {
  it('single-goal one-level expansion returns K children plus the root', async () => {
    const plan = await searchPlan('build feature X', {
      branchingFactor: 3,
      maxDepth: 1,
      evaluator: tableEvaluator({}),
      expander: fanOutExpander(),
    });

    // Root + 3 children = 4 thoughts.
    expect(plan.thoughts.length).toBe(4);
    const root = plan.thoughts[0];
    expect(root?.depth).toBe(0);
    expect(root?.parentId).toBeNull();

    // The three children should have depth=1 and point at the root.
    const children = plan.thoughts.filter((t) => t.depth === 1);
    expect(children.length).toBe(3);
    expect(children.every((c) => c.parentId === root?.id)).toBe(true);
    expect(plan.rootGoal).toBe('build feature X');
  });

  it('beam search prunes low-score branches outside the beam', async () => {
    // 3 children of root: scores 0.9, 0.4, 0.1. Beam width = 1 means
    // only the 0.9 survives to layer 2.
    let i = 0;
    const expander: Expander = async (parent, k) => {
      const out: Thought[] = [];
      const scores = i === 0 ? [0.9, 0.4, 0.1] : [0.5, 0.5, 0.5];
      i += 1;
      for (let j = 0; j < k; j += 1) {
        out.push({
          id: 't',
          content: `lvl-${parent.depth + 1}-${j}-s${scores[j] ?? 0.5}`,
          depth: parent.depth + 1,
          parentId: parent.id,
          score: 0,
          explored: false,
        });
      }
      return out;
    };

    const evaluator: Evaluator = async (t) => {
      const m = /s([\d.]+)$/u.exec(t.content);
      return m ? Number(m[1]) : 0.5;
    };

    const plan = await searchPlan('goal', {
      branchingFactor: 3,
      maxDepth: 2,
      beamWidth: 1,
      // Disable divergence prune for this beam-width test.
      divergenceThreshold: 1,
      earlyExitScore: 1.1,
      evaluator,
      expander,
    });

    // Layer 1 had 3 children, only 1 (the 0.9) became a parent in
    // layer 2 — so the layer-2 expander only ran once.
    const layer2 = plan.thoughts.filter((t) => t.depth === 2);
    expect(layer2.length).toBe(3);
    expect(plan.pruned).toBeGreaterThan(0);
  });

  it('early-exits when a thought scores >= the configured threshold', async () => {
    // Second-level child hits 0.95 → search should stop right there.
    const expander: Expander = async (parent, k) => {
      const out: Thought[] = [];
      for (let j = 0; j < k; j += 1) {
        out.push({
          id: 't',
          content: parent.depth === 0 ? `mid-${j}` : `leaf-${j}`,
          depth: parent.depth + 1,
          parentId: parent.id,
          score: 0,
          explored: false,
        });
      }
      return out;
    };

    const evaluator: Evaluator = async (t) => {
      if (t.content === 'leaf-0') return 0.95;
      return 0.6;
    };

    const { expander: counted, count } = countingExpander(expander);

    const plan = await searchPlan('goal', {
      branchingFactor: 2,
      maxDepth: 5,
      beamWidth: 3,
      earlyExitScore: 0.85,
      evaluator,
      expander: counted,
    });

    expect(plan.bestScore).toBeGreaterThanOrEqual(0.85);
    // Should have stopped well before maxDepth — count is small.
    expect(count()).toBeLessThan(10);
  });

  it('token budget cap triggers early return with best-so-far', async () => {
    const { evaluator } = countingEvaluator();
    const { expander, count } = countingExpander(fanOutExpander());

    // Budget = 2 expansions worth of tokens.
    const budgetTokens = ESTIMATED_TOKENS_PER_EXPANSION * 2;

    const plan = await searchPlan('goal', {
      branchingFactor: 3,
      maxDepth: 5,
      beamWidth: 3,
      budgetTokens,
      earlyExitScore: 1.1, // never trigger early exit
      divergenceThreshold: 1, // never divergence prune
      evaluator,
      expander,
    });

    // We should NOT have called the expander more than ceil(budget/500).
    expect(count()).toBeLessThanOrEqual(2);
    expect(plan.thoughts.length).toBeGreaterThan(0);
  });

  it('50-expansion hard cap is respected even with a huge token budget', async () => {
    const { expander, count } = countingExpander(fanOutExpander());

    await searchPlan('goal', {
      branchingFactor: 5,
      maxDepth: 100,
      beamWidth: 100,
      budgetTokens: 10_000_000,
      earlyExitScore: 1.1,
      divergenceThreshold: 1,
      evaluator: async () => 0.5,
      expander,
    });

    expect(count()).toBeLessThanOrEqual(HARD_MAX_EXPANSIONS);
  });

  it('is deterministic for a deterministic evaluator + expander', async () => {
    const opts = {
      branchingFactor: 3,
      maxDepth: 3,
      beamWidth: 2,
      earlyExitScore: 1.1,
      divergenceThreshold: 1,
      evaluator: tableEvaluator({}),
      expander: fanOutExpander(),
    } as const;

    const a = await searchPlan('build feature X', { ...opts });
    const b = await searchPlan('build feature X', { ...opts });

    expect(a.thoughts.length).toBe(b.thoughts.length);
    expect(a.bestPath).toEqual(b.bestPath);
    expect(a.bestScore).toBe(b.bestScore);
    expect(a.pruned).toBe(b.pruned);
  });

  it('handles an empty expander result without throwing', async () => {
    const emptyExpander: Expander = async () => [];

    const plan = await searchPlan('goal', {
      branchingFactor: 3,
      maxDepth: 3,
      evaluator: async () => 0.5,
      expander: emptyExpander,
    });

    // Just the root, no children.
    expect(plan.thoughts.length).toBe(1);
    expect(plan.bestPath).toEqual([plan.thoughts[0]?.id]);
    expect(plan.bestScore).toBe(0);
  });

  it('evaluator throw → that child is skipped (search keeps going)', async () => {
    const evaluator: Evaluator = async (t) => {
      if (t.content.endsWith('/0')) throw new Error('boom');
      return 0.5;
    };

    const plan = await searchPlan('goal', {
      branchingFactor: 3,
      maxDepth: 1,
      evaluator,
      expander: fanOutExpander(),
    });

    // Root + 2 surviving children (the third threw → dropped).
    expect(plan.thoughts.length).toBe(3);
    expect(plan.pruned).toBeGreaterThanOrEqual(1);
  });

  it('bestPath returns the correct root → best leaf ancestry', async () => {
    // Layer 1: 3 children, all score 0.6.
    // Layer 2: 3 children of each, but only "goal/1/2" scores 0.9.
    const evaluator: Evaluator = async (t) => {
      if (t.content === 'goal/1/2') return 0.9;
      return 0.6;
    };

    const plan = await searchPlan('goal', {
      branchingFactor: 3,
      maxDepth: 2,
      beamWidth: 3,
      earlyExitScore: 1.1,
      divergenceThreshold: 1,
      evaluator,
      expander: fanOutExpander(),
    });

    // bestPath should be 3 long: root → "goal/1" → "goal/1/2"
    expect(plan.bestPath.length).toBe(3);

    const byId = new Map(plan.thoughts.map((t) => [t.id, t] as const));
    const rootContent = byId.get(plan.bestPath[0] ?? '')?.content;
    const midContent = byId.get(plan.bestPath[1] ?? '')?.content;
    const leafContent = byId.get(plan.bestPath[2] ?? '')?.content;
    expect(rootContent).toBe('goal');
    expect(midContent).toBe('goal/1');
    expect(leafContent).toBe('goal/1/2');
    expect(plan.bestScore).toBeCloseTo(0.9);
  });

  it('pruned count is accurate when divergence prune fires', async () => {
    // Parent at depth 1 will score 0.9. Its three children all score
    // 0.1 → divergence > 0.3 → all three pruned.
    const evaluator: Evaluator = async (t) => {
      if (t.depth === 1 && t.content === 'goal/0') return 0.9;
      if (t.depth === 1) return 0.5;
      if (t.depth === 2) return 0.1;
      return 0;
    };

    const plan = await searchPlan('goal', {
      branchingFactor: 3,
      maxDepth: 2,
      beamWidth: 3,
      earlyExitScore: 1.1,
      divergenceThreshold: 0.3,
      evaluator,
      expander: fanOutExpander(),
    });

    // Children of goal/0 (depth-2): 3 thoughts at 0.1 vs parent 0.9
    // → collapse > 0.3 → all 3 pruned.
    expect(plan.pruned).toBeGreaterThanOrEqual(3);
  });

  it('returns thoughts as a frozen immutable array of frozen thoughts', async () => {
    const plan = await searchPlan('goal', {
      branchingFactor: 2,
      maxDepth: 1,
      evaluator: async () => 0.5,
      expander: fanOutExpander(),
    });

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.thoughts)).toBe(true);
    for (const t of plan.thoughts) {
      expect(Object.isFrozen(t)).toBe(true);
    }
  });

  it('clamps an out-of-range evaluator score into [0, 1]', async () => {
    const evaluator: Evaluator = async () => 99;
    const plan = await searchPlan('goal', {
      branchingFactor: 1,
      maxDepth: 1,
      evaluator,
      expander: fanOutExpander(),
    });
    expect(plan.bestScore).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Heuristic evaluator + cosine helper
// ─────────────────────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 when either vector is all zeros', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 1, 1])).toBe(0);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [1, 2])).toBe(0);
  });
});

describe('heuristicEvaluator', () => {
  it('scores higher for content whose embedding aligns with the goal', async () => {
    // Toy embedder: returns a 2-d vector based on a keyword bag.
    const embedder = async (text: string): Promise<ReadonlyArray<number>> => {
      const x = text.includes('foo') ? 1 : 0;
      const y = text.includes('bar') ? 1 : 0;
      return [x, y];
    };
    const evaluator = heuristicEvaluator(embedder);

    const goalCtx = { goal: 'foo bar baz' };
    const aligned: Thought = {
      id: 'a',
      content: 'foo and bar',
      depth: 1,
      parentId: 'root',
      score: 0,
      explored: false,
    };
    const orthogonal: Thought = {
      id: 'b',
      content: 'unrelated',
      depth: 1,
      parentId: 'root',
      score: 0,
      explored: false,
    };

    const sAligned = await evaluator(aligned, goalCtx);
    const sOrth = await evaluator(orthogonal, goalCtx);
    expect(sAligned).toBeGreaterThan(sOrth);
  });
});

// ─────────────────────────────────────────────────────────────────────
// LLM-backed expander default
// ─────────────────────────────────────────────────────────────────────

describe('llmExpander', () => {
  it('parses one thought per line and truncates to K', async () => {
    const sensor = {
      async call(_prompt: string) {
        return [
          '- step one',
          '2. step two',
          '* step three',
          'step four',
        ].join('\n');
      },
    };
    const expander = llmExpander(sensor);
    const parent: Thought = {
      id: 'root',
      content: 'goal',
      depth: 0,
      parentId: null,
      score: 0,
      explored: false,
    };

    const children = await expander(parent, 3);
    expect(children.map((c) => c.content)).toEqual([
      'step one',
      'step two',
      'step three',
    ]);
    expect(children.every((c) => c.parentId === 'root')).toBe(true);
    expect(children.every((c) => c.depth === 1)).toBe(true);
  });

  it('returns [] when the sensor throws', async () => {
    const sensor = {
      async call() {
        throw new Error('sensor down');
      },
    };
    const expander = llmExpander(sensor);
    const parent: Thought = {
      id: 'root',
      content: 'goal',
      depth: 0,
      parentId: null,
      score: 0,
      explored: false,
    };
    const out = await expander(parent, 3);
    expect(out).toEqual([]);
  });

  it('skips empty lines from the sensor response', async () => {
    const sensor = {
      async call() {
        return '\n\nfirst\n\nsecond\n\n';
      },
    };
    const expander = llmExpander({ call: sensor.call });
    const parent: Thought = {
      id: 'root',
      content: 'goal',
      depth: 0,
      parentId: null,
      score: 0,
      explored: false,
    };
    const out = await expander(parent, 5);
    expect(out.map((c) => c.content)).toEqual(['first', 'second']);
  });
});

describe('buildExpanderPrompt', () => {
  it('includes the parent content and the requested K', () => {
    const prompt = buildExpanderPrompt(
      {
        id: 'x',
        content: 'do the thing',
        depth: 2,
        parentId: 'p',
        score: 0,
        explored: false,
      },
      4,
    );
    expect(prompt).toContain('do the thing');
    expect(prompt).toContain('4');
    expect(prompt).toContain('depth 2');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Default sanity
// ─────────────────────────────────────────────────────────────────────

describe('defaults', () => {
  it('exposes the documented numeric constants', () => {
    expect(DEFAULT_BRANCHING_FACTOR).toBe(3);
    expect(DEFAULT_MAX_DEPTH).toBe(4);
    expect(HARD_MAX_EXPANSIONS).toBe(50);
    expect(ESTIMATED_TOKENS_PER_EXPANSION).toBe(500);
  });
});
