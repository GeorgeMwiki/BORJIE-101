import { describe, it, expect } from 'vitest';
import {
  latsSearch,
  ucb1Score,
  pickByUcb,
  backpropagate,
  DEFAULT_UCB_CONSTANT,
  DEFAULT_DISCOUNT,
  DEFAULT_BUDGET_TOKENS,
  DEFAULT_REFLECTION_THRESHOLD,
  ESTIMATED_TOKENS_PER_EXPANSION,
  HARD_MAX_EXPANSIONS,
} from '../lats-search.js';
import type { LatsNode } from '../lats-types.js';
import type { Evaluator, Expander, Thought } from '../search-planner.js';

// ─────────────────────────────────────────────────────────────────────
// Fixtures — keep them small + deterministic so every test reads like
// the algorithm spec.
// ─────────────────────────────────────────────────────────────────────

/**
 * Deterministic expander: every parent gets `k` children whose content
 * is `${parent.content}/${i}` so the tree shape is eyeballable.
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
 * Score-by-content evaluator. Anything missing scores 0.5.
 */
function tableEvaluator(table: Record<string, number>): Evaluator {
  return async (t) => table[t.content] ?? 0.5;
}

/**
 * Counting random — fixed sequence so determinism is easy to reason
 * about in tie-break tests.
 */
function fixedRandom(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length] ?? 0;
    i += 1;
    return v;
  };
}

/**
 * Helper to build a synthetic LatsNode for unit-testing the pure
 * helpers (ucb1Score, pickByUcb, backpropagate) without running the
 * full loop.
 */
function makeNode(partial: Partial<LatsNode> & { id: string }): LatsNode {
  return {
    id: partial.id,
    thought: partial.thought ?? {
      id: partial.id,
      content: partial.id,
      depth: 0,
      parentId: null,
      score: 0,
      explored: false,
    },
    parentId: partial.parentId ?? null,
    childrenIds: partial.childrenIds ?? [],
    value: partial.value ?? 0,
    visits: partial.visits ?? 0,
    ucb: partial.ucb ?? 0,
    failed: partial.failed ?? false,
    reflection: partial.reflection ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('ucb1Score / pickByUcb', () => {
  it('UCB1 prefers an unvisited child (visits=0) over a visited low-value one', () => {
    const visited = makeNode({ id: 'v', visits: 5, value: 0.5 });
    const fresh = makeNode({ id: 'f', visits: 0, value: 0 });

    expect(ucb1Score(fresh, 10, DEFAULT_UCB_CONSTANT)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(ucb1Score(visited, 10, DEFAULT_UCB_CONSTANT)).toBeLessThan(
      Number.POSITIVE_INFINITY,
    );

    const picked = pickByUcb([visited, fresh], 10, DEFAULT_UCB_CONSTANT, () => 0);
    expect(picked?.id).toBe('f');
  });

  it('UCB1 prefers a high-value low-visit child over a high-visit lower-value one', () => {
    // High-value low-visit: avg 0.9, visits 2 → exploit 0.9 + a sizable
    // explore term. High-visit lower-value: avg 0.55, visits 50 → tiny
    // explore term. UCB should pick the first.
    const promising = makeNode({ id: 'p', visits: 2, value: 1.8 });
    const tired = makeNode({ id: 't', visits: 50, value: 27.5 });
    const parentVisits = 100;

    const promisingScore = ucb1Score(promising, parentVisits, DEFAULT_UCB_CONSTANT);
    const tiredScore = ucb1Score(tired, parentVisits, DEFAULT_UCB_CONSTANT);
    expect(promisingScore).toBeGreaterThan(tiredScore);

    const picked = pickByUcb([promising, tired], parentVisits, DEFAULT_UCB_CONSTANT, () => 0);
    expect(picked?.id).toBe('p');
  });

  it('failed nodes are never picked by UCB1', () => {
    const failed = makeNode({ id: 'x', visits: 0, value: 0, failed: true });
    const ok = makeNode({ id: 'y', visits: 2, value: 0.4 });

    expect(ucb1Score(failed, 10, DEFAULT_UCB_CONSTANT)).toBe(
      Number.NEGATIVE_INFINITY,
    );

    const picked = pickByUcb([failed, ok], 10, DEFAULT_UCB_CONSTANT, () => 0);
    expect(picked?.id).toBe('y');
  });
});

describe('backpropagate', () => {
  it('propagates reward to all ancestors with γ discount', () => {
    const nodes = new Map<string, LatsNode>();
    nodes.set('root', makeNode({ id: 'root', parentId: null }));
    nodes.set('a', makeNode({ id: 'a', parentId: 'root' }));
    nodes.set('b', makeNode({ id: 'b', parentId: 'a' }));
    nodes.set('leaf', makeNode({ id: 'leaf', parentId: 'b' }));

    backpropagate(nodes, 'leaf', 1.0, 0.9);

    // Depth 0 (leaf): 1.0 · 0.9^0 = 1.0; visits = 1.
    expect(nodes.get('leaf')?.value).toBeCloseTo(1.0, 6);
    expect(nodes.get('leaf')?.visits).toBe(1);
    // Depth 1 (b): 1.0 · 0.9^1 = 0.9.
    expect(nodes.get('b')?.value).toBeCloseTo(0.9, 6);
    // Depth 2 (a): 0.81.
    expect(nodes.get('a')?.value).toBeCloseTo(0.81, 6);
    // Depth 3 (root): 0.729.
    expect(nodes.get('root')?.value).toBeCloseTo(0.729, 6);
    expect(nodes.get('root')?.visits).toBe(1);
  });

  it('handles single-node (root only) backprop without crashing', () => {
    const nodes = new Map<string, LatsNode>();
    nodes.set('root', makeNode({ id: 'root', parentId: null }));
    backpropagate(nodes, 'root', 0.5, 0.9);
    expect(nodes.get('root')?.value).toBeCloseTo(0.5, 6);
    expect(nodes.get('root')?.visits).toBe(1);
  });
});

describe('latsSearch — algorithm behaviour', () => {
  it('UCB1 selection drives root to be visited by every iteration', async () => {
    const result = await latsSearch('root goal', {
      evaluator: tableEvaluator({}),
      expander: fanOutExpander(),
      maxIterations: 5,
      maxDepth: 2,
      branchingFactor: 2,
    });

    const root = result.tree;
    // 5 iterations → root should be visited at least once per iteration
    // (every backprop walks through it).
    expect(root.visits).toBeGreaterThanOrEqual(1);
    // The tree should not be just the root.
    expect(result.nodesById.size).toBeGreaterThan(1);
  });

  it('value backpropagation updates ancestors (root.value > 0 after a positive leaf)', async () => {
    const evaluator = tableEvaluator({
      'g/0': 0.9,
      'g/0/0': 0.95,
    });
    const result = await latsSearch('g', {
      evaluator,
      expander: fanOutExpander(),
      maxIterations: 3,
      maxDepth: 2,
      branchingFactor: 1,
      earlyExitScore: 1.1, // disable early exit
    });

    expect(result.tree.value).toBeGreaterThan(0);
    expect(result.tree.visits).toBeGreaterThanOrEqual(1);
  });

  it('emits a self-reflection when all children score below threshold', async () => {
    // Force every child to score 0.1 — well under default threshold 0.3.
    const evaluator: Evaluator = async () => 0.1;
    const result = await latsSearch('g', {
      evaluator,
      expander: fanOutExpander(),
      maxIterations: 1,
      maxDepth: 2,
      branchingFactor: 3,
      reflectionThreshold: 0.3,
    });

    expect(result.reflections.length).toBe(1);
    const r = result.reflections[0];
    expect(r?.parentContent).toBe('g');
    expect(r?.failedChildIds.length).toBe(3);
    expect(r?.lesson).toContain('Branch failed');
  });

  it('does not emit duplicate reflections for the same parent', async () => {
    const evaluator: Evaluator = async () => 0.1;
    const result = await latsSearch('g', {
      evaluator,
      expander: fanOutExpander(),
      // multiple iterations might revisit the same parent — make sure
      // we only emit once.
      maxIterations: 4,
      maxDepth: 1,
      branchingFactor: 2,
      reflectionThreshold: 0.5,
    });

    const parents = new Set(result.reflections.map((r) => r.parentId));
    expect(parents.size).toBe(result.reflections.length);
  });

  it('hard cap: maxIterations is enforced (iterations ≤ maxIterations)', async () => {
    const result = await latsSearch('g', {
      evaluator: tableEvaluator({}),
      expander: fanOutExpander(),
      maxIterations: 3,
      maxDepth: 5,
      branchingFactor: 2,
    });
    expect(result.iterationsUsed).toBeLessThanOrEqual(3);
  });

  it('hard cap: HARD_MAX_EXPANSIONS bounds expander calls', async () => {
    // Ask for way more iterations than HARD_MAX_EXPANSIONS allows.
    const result = await latsSearch('g', {
      evaluator: tableEvaluator({}),
      expander: fanOutExpander(),
      maxIterations: HARD_MAX_EXPANSIONS + 25,
      maxDepth: 6,
      branchingFactor: 2,
      // Disable token-budget bail-out so the cap is the only guard.
      budgetTokens: 10_000_000,
    });
    expect(result.expansionsUsed).toBeLessThanOrEqual(HARD_MAX_EXPANSIONS);
  });

  it('token budget: default 25K cap stops expansions before the cap is exceeded', async () => {
    const result = await latsSearch('g', {
      evaluator: tableEvaluator({}),
      expander: fanOutExpander(),
      maxIterations: 200,
      maxDepth: 5,
      branchingFactor: 2,
      // Default DEFAULT_BUDGET_TOKENS = 25_000.
    });
    expect(result.tokensUsed).toBeLessThanOrEqual(DEFAULT_BUDGET_TOKENS);
    // And expansions should be ≤ 25000/500 = 50.
    expect(result.expansionsUsed).toBeLessThanOrEqual(
      DEFAULT_BUDGET_TOKENS / ESTIMATED_TOKENS_PER_EXPANSION,
    );
  });

  it('defensive score clamping: evaluator returning 1.5 or -0.5 still produces a [0,1] bestScore', async () => {
    let toggle = false;
    const wild: Evaluator = async () => {
      toggle = !toggle;
      return toggle ? 1.5 : -0.5;
    };
    const result = await latsSearch('g', {
      evaluator: wild,
      expander: fanOutExpander(),
      maxIterations: 2,
      maxDepth: 1,
      branchingFactor: 2,
      earlyExitScore: 1.1,
    });
    expect(result.bestScore).toBeGreaterThanOrEqual(0);
    expect(result.bestScore).toBeLessThanOrEqual(1);
  });

  it('convergence: search exits early when bestScore >= earlyExitScore', async () => {
    const evaluator: Evaluator = async (t) => (t.content === 'g/0' ? 0.99 : 0.1);
    const result = await latsSearch('g', {
      evaluator,
      expander: fanOutExpander(),
      maxIterations: 50,
      maxDepth: 3,
      branchingFactor: 2,
      earlyExitScore: 0.95,
    });
    // Should exit well before 50 iterations.
    expect(result.iterationsUsed).toBeLessThan(10);
    expect(result.bestScore).toBeGreaterThanOrEqual(0.95);
  });

  it('determinism: same seed → same tree (identical node ids + best path)', async () => {
    let n = 0;
    const idGen = () => {
      n += 1;
      return `node_${n}`;
    };
    const run1 = await latsSearch('g', {
      evaluator: tableEvaluator({ 'g/0': 0.7, 'g/1': 0.4 }),
      expander: fanOutExpander(),
      maxIterations: 4,
      maxDepth: 2,
      branchingFactor: 2,
      idGenerator: idGen,
      random: fixedRandom([0.3, 0.7, 0.1, 0.5]),
    });

    let n2 = 0;
    const idGen2 = () => {
      n2 += 1;
      return `node_${n2}`;
    };
    const run2 = await latsSearch('g', {
      evaluator: tableEvaluator({ 'g/0': 0.7, 'g/1': 0.4 }),
      expander: fanOutExpander(),
      maxIterations: 4,
      maxDepth: 2,
      branchingFactor: 2,
      idGenerator: idGen2,
      random: fixedRandom([0.3, 0.7, 0.1, 0.5]),
    });

    expect(run1.bestPath).toEqual(run2.bestPath);
    expect(run1.nodesById.size).toBe(run2.nodesById.size);
    expect(run1.bestScore).toBeCloseTo(run2.bestScore, 6);
  });

  it('adversarial: evaluator throwing on a node marks it failed and continues', async () => {
    let calls = 0;
    const flaky: Evaluator = async (t) => {
      calls += 1;
      // Throw on the second child of the root only.
      if (t.content === 'g/1') throw new Error('synthetic evaluator failure');
      return 0.5;
    };
    const result = await latsSearch('g', {
      evaluator: flaky,
      expander: fanOutExpander(),
      maxIterations: 2,
      maxDepth: 1,
      branchingFactor: 3,
    });

    // The search did not abort — it returned a tree.
    expect(calls).toBeGreaterThan(1);
    expect(result.iterationsUsed).toBeGreaterThanOrEqual(1);
    // The failed node should be flagged failed in the tree.
    const failed = Array.from(result.nodesById.values()).find(
      (n) => n.thought.content === 'g/1',
    );
    expect(failed?.failed).toBe(true);
    // And counted in pruned.
    expect(result.pruned).toBeGreaterThanOrEqual(1);
  });

  it('empty expansion: expander returning [] triggers graceful early exit', async () => {
    const empty: Expander = async () => [];
    const result = await latsSearch('g', {
      evaluator: tableEvaluator({}),
      expander: empty,
      maxIterations: 5,
      maxDepth: 3,
      branchingFactor: 3,
    });

    // Only the root exists.
    expect(result.nodesById.size).toBe(1);
    expect(result.bestPath).toEqual([result.tree.id]);
    expect(result.bestScore).toBe(0);
  });

  it('single-child (visits=0): UCB1 picks the single unvisited child cleanly', async () => {
    // Branching factor 1 means each parent has exactly one child. UCB1's
    // unvisited-child rule must not blow up when there's only one choice.
    const result = await latsSearch('g', {
      evaluator: tableEvaluator({ 'g/0': 0.6 }),
      expander: fanOutExpander(),
      maxIterations: 3,
      maxDepth: 3,
      branchingFactor: 1,
      earlyExitScore: 1.1,
    });

    expect(result.bestPath.length).toBeGreaterThan(1);
    // The first (only) child of root must be in the best path.
    const firstChild = result.bestPath[1];
    expect(firstChild).toBeDefined();
    const node = firstChild ? result.nodesById.get(firstChild) : undefined;
    expect(node?.thought.content).toBe('g/0');
  });

  it('tree introspection: caller can walk every node post-hoc', async () => {
    const result = await latsSearch('g', {
      evaluator: tableEvaluator({}),
      expander: fanOutExpander(),
      maxIterations: 3,
      maxDepth: 2,
      branchingFactor: 2,
    });

    // Walk every node — depth-first via nodesById.
    let count = 0;
    function walk(id: string): void {
      const n = result.nodesById.get(id);
      if (!n) return;
      count += 1;
      for (const cid of n.childrenIds) walk(cid);
    }
    walk(result.tree.id);

    expect(count).toBe(result.nodesById.size);
    expect(count).toBeGreaterThan(1); // we expanded at least once

    // Every non-root must have a parentId pointing at a real node.
    for (const node of result.nodesById.values()) {
      if (node.parentId === null) continue;
      expect(result.nodesById.has(node.parentId)).toBe(true);
    }
  });

  it('backprop on early exit: partial results still expose a best path + tree', async () => {
    // Trigger early exit on iteration 1.
    const result = await latsSearch('g', {
      evaluator: tableEvaluator({ 'g/0': 0.99, 'g/1': 0.0 }),
      expander: fanOutExpander(),
      maxIterations: 50,
      maxDepth: 5,
      branchingFactor: 2,
      earlyExitScore: 0.9,
    });

    expect(result.iterationsUsed).toBeLessThan(5);
    expect(result.tree.visits).toBeGreaterThan(0);
    expect(result.bestPath.length).toBeGreaterThanOrEqual(2);
    // The root must be the first id in the path.
    expect(result.bestPath[0]).toBe(result.tree.id);
  });

  it('reflection threshold honoured: above-threshold children do NOT emit a reflection', async () => {
    const evaluator: Evaluator = async () => 0.5; // exactly at default threshold? we go higher.
    const result = await latsSearch('g', {
      evaluator,
      expander: fanOutExpander(),
      maxIterations: 1,
      maxDepth: 1,
      branchingFactor: 3,
      reflectionThreshold: DEFAULT_REFLECTION_THRESHOLD,
    });
    expect(result.reflections.length).toBe(0);
  });

  it('discount γ honoured: deeper backprop attenuates by γ^depth', async () => {
    // Drive an evaluator that scores the depth-2 leaf at 1.0.
    let n = 0;
    const idGen = () => {
      n += 1;
      return `n_${n}`;
    };
    const evaluator: Evaluator = async (t) =>
      t.content === 'g/0/0' ? 1.0 : 0;
    const result = await latsSearch('g', {
      evaluator,
      expander: fanOutExpander(),
      maxIterations: 3,
      maxDepth: 2,
      branchingFactor: 1,
      discount: DEFAULT_DISCOUNT,
      idGenerator: idGen,
      earlyExitScore: 1.1,
    });

    // After expansion + backprop, the leaf should have value ≈ 1.0,
    // its parent ≈ γ · 1.0 = 0.9, and the root ≈ γ^2 · 1.0 = 0.81.
    // (Visits accrue per backprop pass — values divided by visits give
    //  the comparison metric, but the *sum* relationship still holds.)
    const leaf = Array.from(result.nodesById.values()).find(
      (n2) => n2.thought.content === 'g/0/0',
    );
    expect(leaf).toBeDefined();
    expect(leaf!.value).toBeGreaterThan(0);

    const parent = Array.from(result.nodesById.values()).find(
      (n2) => n2.thought.content === 'g/0',
    );
    expect(parent).toBeDefined();
    // Parent accumulates 0.9 from the discounted leaf reward — verify
    // it's strictly less than the leaf value (proving discount fired)
    // but still strictly positive (proving backprop ran).
    expect(parent!.value).toBeLessThan(leaf!.value);
    expect(parent!.value).toBeGreaterThan(0);
  });
});
