import type { ModelAdapter, JsonValue } from '../shared/types.js';
import type {
  GoTEdge,
  GoTNode,
  GoTOp,
  GoTResult,
  RunGoTInput,
} from './types.js';

/**
 * Self-rate the produced thought. Default heuristic: longer = lower (cap),
 * but in production the model adapter should emit a structured rating —
 * see `parseScoredResponse` for the format we look for.
 */
function defaultScoreFromText(text: string): number {
  // crude heuristic; replaced by `parseScoredResponse` if the model returns
  // a `[score: 0.8]` prefix.
  const match = /^\s*\[score:\s*([0-9]*\.?[0-9]+)\]/i.exec(text);
  if (match && match[1] !== undefined) {
    const v = Number.parseFloat(match[1]);
    if (Number.isFinite(v)) return Math.max(0, Math.min(1, v));
  }
  // length-based fallback — penalise excessively long responses
  const len = text.length;
  if (len < 40) return 0.4;
  if (len < 400) return 0.7;
  if (len < 1200) return 0.6;
  return 0.5;
}

function stripScorePrefix(text: string): string {
  return text.replace(/^\s*\[score:\s*[0-9]*\.?[0-9]+\]\s*/i, '');
}

interface InternalNode {
  readonly id: string;
  readonly op: GoTNode['op'];
  readonly content: JsonValue;
  readonly score: number;
  readonly labels: ReadonlyArray<string>;
}

/**
 * Build a topologically-sorted list of op ids based on data dependencies.
 * Throws if a cycle is detected (GoT must be a DAG).
 */
function topoSort(ops: ReadonlyArray<GoTOp>): ReadonlyArray<string> {
  const ids = new Map<string, GoTOp>();
  for (const op of ops) {
    const id = opTargetId(op);
    if (ids.has(id)) {
      throw new Error(`[GoT] duplicate node id in ops: ${id}`);
    }
    ids.set(id, op);
  }

  const deps = new Map<string, ReadonlyArray<string>>();
  for (const op of ops) {
    const id = opTargetId(op);
    deps.set(id, opDependencies(op));
  }

  const visited = new Set<string>();
  const onStack = new Set<string>();
  const order: string[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (onStack.has(id)) {
      throw new Error(`[GoT] cycle detected at node "${id}"`);
    }
    onStack.add(id);
    const d = deps.get(id) ?? [];
    for (const dep of d) {
      // dep must reference a node produced by some op (or be an existing
      // upstream id — but ops define the full graph so we require it)
      if (!ids.has(dep) && !isPrimordial(dep)) {
        throw new Error(`[GoT] op for "${id}" depends on unknown node "${dep}"`);
      }
      if (ids.has(dep)) visit(dep);
    }
    onStack.delete(id);
    visited.add(id);
    order.push(id);
  }

  for (const id of ids.keys()) visit(id);
  return order;
}

function isPrimordial(_id: string): boolean {
  // Reserved for future use where callers seed external node ids. Right now
  // every node must be produced by an op in `ops`.
  return false;
}

function opTargetId(op: GoTOp): string {
  if (op.kind === 'split') {
    // Split produces multiple ids; we pick the first as the "target" for
    // topo ordering, and the runner emits one node per id with edge kind=data.
    const first = op.intoIds[0];
    if (first === undefined) {
      throw new Error('[GoT] split op must have at least one intoIds entry');
    }
    return first;
  }
  return op.id;
}

function opDependencies(op: GoTOp): ReadonlyArray<string> {
  switch (op.kind) {
    case 'generate':
      return [];
    case 'refine':
      return [op.from];
    case 'merge':
      return op.from;
    case 'split':
      return [op.fromId];
  }
}

/**
 * Run a GoT plan. The model adapter is called once per op; merges receive
 * the joined content of their parents in the prompt.
 *
 * Throws on cycles or unknown-node references.
 */
export async function runGoT(
  input: RunGoTInput,
  model: ModelAdapter,
): Promise<GoTResult> {
  if (input.question.trim().length === 0) {
    throw new Error('[GoT] question must not be empty');
  }

  const order = topoSort(input.ops);
  const nodesById = new Map<string, InternalNode>();
  const edges: GoTEdge[] = [];

  // Build a quick lookup from target id → op so we can iterate in topo order.
  const opByTarget = new Map<string, GoTOp>();
  for (const op of input.ops) opByTarget.set(opTargetId(op), op);

  for (const id of order) {
    const op = opByTarget.get(id);
    if (op === undefined) {
      throw new Error(`[GoT] internal: missing op for ordered id ${id}`);
    }
    await applyOp(op, input.question, nodesById, edges, model);
  }

  // Final reducer is optional; if present we run it as one more op.
  let finalNodeId: string | undefined;
  if (input.finalReducer !== undefined) {
    await applyOp(input.finalReducer, input.question, nodesById, edges, model);
    finalNodeId = opTargetId(input.finalReducer);
  }

  // Compute bestNodeId — highest score; deterministic tie-break by id.
  let best: InternalNode | undefined;
  for (const node of nodesById.values()) {
    if (best === undefined) {
      best = node;
    } else if (node.score > best.score || (node.score === best.score && node.id < best.id)) {
      best = node;
    }
  }
  if (best === undefined) {
    throw new Error('[GoT] no nodes were produced — provide at least one op');
  }

  return {
    graph: {
      nodes: Array.from(nodesById.values()).map((n) => ({
        id: n.id,
        op: n.op,
        content: n.content,
        score: n.score,
        labels: n.labels,
      })),
      edges,
    },
    evaluationOrder: order,
    ...(finalNodeId !== undefined ? { finalNodeId } : {}),
    bestNodeId: best.id,
  };
}

async function applyOp(
  op: GoTOp,
  question: string,
  nodesById: Map<string, InternalNode>,
  edges: GoTEdge[],
  model: ModelAdapter,
): Promise<void> {
  switch (op.kind) {
    case 'generate': {
      const out = await model({ prompt: `${question}\n\n${op.prompt}` });
      nodesById.set(op.id, {
        id: op.id,
        op: 'generate',
        content: stripScorePrefix(out),
        score: defaultScoreFromText(out),
        labels: op.labels ?? [],
      });
      return;
    }
    case 'refine': {
      const parent = nodesById.get(op.from);
      if (parent === undefined) {
        throw new Error(`[GoT] refine "${op.id}" references missing node "${op.from}"`);
      }
      const out = await model({
        prompt: `${question}\n\nRefine the following thought:\n${JSON.stringify(parent.content)}\n\nInstruction: ${op.prompt}`,
      });
      nodesById.set(op.id, {
        id: op.id,
        op: 'refine',
        content: stripScorePrefix(out),
        score: defaultScoreFromText(out),
        labels: op.labels ?? parent.labels,
      });
      edges.push({ from: op.from, to: op.id, kind: 'refines' });
      return;
    }
    case 'merge': {
      const parents = op.from.map((fid) => {
        const p = nodesById.get(fid);
        if (p === undefined) {
          throw new Error(`[GoT] merge "${op.id}" references missing node "${fid}"`);
        }
        return p;
      });
      const merged = parents.map((p) => `## ${p.id}\n${JSON.stringify(p.content)}`).join('\n\n');
      const out = await model({
        prompt: `${question}\n\nAggregate the following thoughts:\n${merged}\n\nInstruction: ${op.prompt}`,
      });
      // Inherit union of parent labels by default
      const labels = op.labels ?? Array.from(new Set(parents.flatMap((p) => p.labels)));
      nodesById.set(op.id, {
        id: op.id,
        op: 'merge',
        content: stripScorePrefix(out),
        score: defaultScoreFromText(out),
        labels,
      });
      for (const fid of op.from) edges.push({ from: fid, to: op.id, kind: 'merges' });
      return;
    }
    case 'split': {
      const parent = nodesById.get(op.fromId);
      if (parent === undefined) {
        throw new Error(`[GoT] split references missing node "${op.fromId}"`);
      }
      const out = await model({
        prompt: `${question}\n\nSplit the following thought into ${op.intoIds.length} parts:\n${JSON.stringify(parent.content)}\n\nInstruction: ${op.prompt}`,
      });
      // For determinism, attempt to split the model response into N parts on
      // double-newline; fall back to repeating the whole thing labelled.
      const stripped = stripScorePrefix(out);
      const parts = splitIntoParts(stripped, op.intoIds.length);
      const score = defaultScoreFromText(out);
      for (let i = 0; i < op.intoIds.length; i += 1) {
        const nid = op.intoIds[i];
        if (nid === undefined) continue;
        nodesById.set(nid, {
          id: nid,
          op: 'split',
          content: parts[i] ?? '',
          score,
          labels: op.labels ?? parent.labels,
        });
        edges.push({ from: op.fromId, to: nid, kind: 'data' });
      }
      return;
    }
  }
}

function splitIntoParts(text: string, n: number): ReadonlyArray<string> {
  if (n <= 0) return [];
  const blocks = text.split(/\n\n+/).map((b) => b.trim()).filter((b) => b.length > 0);
  if (blocks.length >= n) return blocks.slice(0, n);
  // Pad by repeating the last block (so the split still produces N children)
  const padded = blocks.slice();
  const fill = blocks[blocks.length - 1] ?? text;
  while (padded.length < n) padded.push(fill);
  return padded;
}
