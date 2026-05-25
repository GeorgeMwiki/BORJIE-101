import type {
  DecisionTree,
  RunToTInput,
  RunToTResult,
  RunToTTreeInput,
  RunToTTreeResult,
  ToTPathStep,
} from './types.js';

/**
 * Walk a fixed decision tree. At each node, evaluate edges in order; the
 * first edge whose predicate returns true is followed. Stops when a node
 * has no edges (leaf) and emits its `outcome`.
 *
 * Throws if no edge matches and the node has no outcome (malformed tree
 * or under-specified context).
 */
export function runToTTree(input: RunToTTreeInput): RunToTTreeResult {
  const { tree, ctx } = input;
  const maxVisits = input.maxVisits ?? 256;
  const seen = new Set<string>();
  const path: ToTPathStep[] = [];

  let currentId = tree.rootNodeId;
  let visits = 0;
  while (true) {
    visits += 1;
    if (visits > maxVisits) {
      throw new Error(
        `[ToT] runtime exceeded maxVisits=${maxVisits} (tree=${tree.id}); possible cycle`,
      );
    }
    if (seen.has(currentId)) {
      throw new Error(`[ToT] cycle detected at node "${currentId}" in tree "${tree.id}"`);
    }
    seen.add(currentId);
    const node = tree.nodes[currentId];
    if (node === undefined) {
      throw new Error(`[ToT] tree "${tree.id}" references missing node "${currentId}"`);
    }

    if (node.outcome !== undefined && (node.edges === undefined || node.edges.length === 0)) {
      path.push({ nodeId: node.id, question: node.question });
      return { outcome: node.outcome, path, visited: visits };
    }

    let matched: ToTPathStep | undefined;
    let nextId: string | undefined;
    if (node.edges !== undefined) {
      for (const edge of node.edges) {
        if (edge.when(ctx)) {
          matched = { nodeId: node.id, question: node.question, edgeLabel: edge.label };
          nextId = edge.toNodeId;
          break;
        }
      }
    }

    if (matched === undefined || nextId === undefined) {
      // Allow inline outcome on inner nodes when no edge matches and an
      // outcome is provided — this is the "default outcome" pattern.
      if (node.outcome !== undefined) {
        path.push({ nodeId: node.id, question: node.question });
        return { outcome: node.outcome, path, visited: visits };
      }
      throw new Error(
        `[ToT] no edge matched at node "${currentId}" in tree "${tree.id}" and no default outcome — under-specified context`,
      );
    }

    path.push(matched);
    currentId = nextId;
  }
}

/**
 * BFS/DFS over a free-form thought space — used when we still want raw ToT's
 * exploration semantics but don't have a fixed tree. Returns the
 * highest-evaluated thought encountered.
 */
export function runToT(input: RunToTInput): RunToTResult {
  if (input.maxDepth < 0) throw new Error('[ToT] maxDepth must be >= 0');
  if (input.maxBranches <= 0) throw new Error('[ToT] maxBranches must be > 0');

  interface Frame {
    readonly thought: string;
    readonly depth: number;
  }
  const frontier: Frame[] = [{ thought: input.rootThought, depth: 0 }];
  let best = { thought: input.rootThought, score: input.evaluationFn(input.ctx, input.rootThought, 0) };
  let explored = 1;

  while (frontier.length > 0) {
    const frame = input.search === 'dfs' ? frontier.pop() : frontier.shift();
    if (frame === undefined) break;
    if (frame.depth >= input.maxDepth) continue;
    const children = input.branchingFn(input.ctx, frame.thought, frame.depth).slice(0, input.maxBranches);
    for (const child of children) {
      explored += 1;
      const score = input.evaluationFn(input.ctx, child, frame.depth + 1);
      if (score > best.score) best = { thought: child, score };
      frontier.push({ thought: child, depth: frame.depth + 1 });
    }
  }
  return { bestThought: best.thought, bestScore: best.score, explored };
}

/** Validate a tree at runtime — useful in tests. */
export function validateTree(tree: DecisionTree): ReadonlyArray<string> {
  const errors: string[] = [];
  if (!tree.nodes[tree.rootNodeId]) {
    errors.push(`root node "${tree.rootNodeId}" not found in nodes`);
  }
  for (const [id, node] of Object.entries(tree.nodes)) {
    if (node.id !== id) {
      errors.push(`node key "${id}" does not match node.id "${node.id}"`);
    }
    if (node.edges !== undefined) {
      for (const edge of node.edges) {
        if (!tree.nodes[edge.toNodeId]) {
          errors.push(`node "${id}" edge "${edge.label}" → unknown node "${edge.toNodeId}"`);
        }
      }
    }
    if ((node.edges === undefined || node.edges.length === 0) && node.outcome === undefined) {
      errors.push(`leaf node "${id}" has neither edges nor outcome`);
    }
  }
  return errors;
}
