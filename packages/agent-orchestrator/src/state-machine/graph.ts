/**
 * Typed state-machine (LangGraph 0.5 inspired) — finite set of nodes,
 * static edges, optional conditional edges. The orchestrator walks the
 * graph one node at a time, threading an immutable `state` object.
 *
 * Pure runtime: nodes are plain async functions
 *   `(state, brain) => Partial<state> | { goto: nextNode, patch }`
 *
 * Checkpointing: every emitted `StateUpdate` is appended to an
 * in-memory store by default. Inject a custom `CheckpointStore` for
 * Redis / Postgres / Inngest persistence.
 */

import type { BrainPort } from '../types.js';
import { nowIso } from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Public types.
// ─────────────────────────────────────────────────────────────────────

export type NodeId = string;

export interface NodeContext<S> {
  readonly state: S;
  readonly brain: BrainPort;
  readonly runId: string;
  readonly nodeId: NodeId;
}

export type NodeOutput<S> =
  | { readonly patch: Partial<S>; readonly goto?: NodeId | typeof END }
  | { readonly goto: NodeId | typeof END };

export type NodeFn<S> = (ctx: NodeContext<S>) => Promise<NodeOutput<S>>;

export interface ConditionalEdge<S> {
  readonly from: NodeId;
  /** Pure function deciding the next node id. */
  readonly choose: (state: S) => NodeId | typeof END;
}

export interface StaticEdge {
  readonly from: NodeId;
  readonly to: NodeId | typeof END;
}

export interface GraphSpec<S> {
  readonly nodes: ReadonlyMap<NodeId, NodeFn<S>>;
  readonly edges: ReadonlyArray<StaticEdge>;
  readonly conditionalEdges: ReadonlyArray<ConditionalEdge<S>>;
  readonly entry: NodeId;
}

export const END: unique symbol = Symbol('END');
export type END = typeof END;

export interface StateUpdate<S> {
  readonly runId: string;
  readonly node: NodeId;
  readonly state: S;
  readonly step: number;
  readonly at: string;
  readonly terminal: boolean;
}

export interface CheckpointStore<S> {
  save(update: StateUpdate<S>): Promise<void>;
  list(runId: string): Promise<ReadonlyArray<StateUpdate<S>>>;
  /** Return the latest state for resumption; null if none. */
  latest(runId: string): Promise<StateUpdate<S> | null>;
}

// ─────────────────────────────────────────────────────────────────────
// Definition helper.
// ─────────────────────────────────────────────────────────────────────

export interface DefineGraphInput<S> {
  readonly nodes: Readonly<Record<NodeId, NodeFn<S>>>;
  readonly edges?: ReadonlyArray<StaticEdge>;
  readonly conditionalEdges?: ReadonlyArray<ConditionalEdge<S>>;
  readonly entry: NodeId;
}

export function defineGraph<S>(input: DefineGraphInput<S>): GraphSpec<S> {
  if (!input.nodes[input.entry]) {
    throw new Error(`entry node '${input.entry}' not defined`);
  }
  const map = new Map<NodeId, NodeFn<S>>(Object.entries(input.nodes));
  // Validate static edges reference known nodes.
  for (const e of input.edges ?? []) {
    if (!map.has(e.from)) throw new Error(`edge from unknown node '${e.from}'`);
    if (e.to !== END && !map.has(e.to)) throw new Error(`edge to unknown node '${String(e.to)}'`);
  }
  for (const ce of input.conditionalEdges ?? []) {
    if (!map.has(ce.from)) throw new Error(`conditional edge from unknown node '${ce.from}'`);
  }
  return {
    nodes: map,
    edges: input.edges ?? [],
    conditionalEdges: input.conditionalEdges ?? [],
    entry: input.entry,
  };
}

// ─────────────────────────────────────────────────────────────────────
// In-memory checkpoint store (default).
// ─────────────────────────────────────────────────────────────────────

export function createInMemoryCheckpointStore<S>(): CheckpointStore<S> {
  const store = new Map<string, StateUpdate<S>[]>();
  return {
    async save(update) {
      const list = store.get(update.runId) ?? [];
      list.push(update);
      store.set(update.runId, list);
    },
    async list(runId) {
      return [...(store.get(runId) ?? [])];
    },
    async latest(runId) {
      const list = store.get(runId) ?? [];
      return list.at(-1) ?? null;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Runner — streams state updates.
// ─────────────────────────────────────────────────────────────────────

export interface RunGraphInput<S> {
  readonly spec: GraphSpec<S>;
  readonly initialState: S;
  readonly brain: BrainPort;
  readonly runId?: string;
  readonly maxSteps?: number;
  readonly store?: CheckpointStore<S>;
  /** Optional resume — load latest and continue from there. */
  readonly resume?: boolean;
}

export const DEFAULT_GRAPH_MAX_STEPS = 64;

export async function* runGraph<S>(input: RunGraphInput<S>): AsyncIterable<StateUpdate<S>> {
  const store = input.store ?? createInMemoryCheckpointStore<S>();
  const runId = input.runId ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const maxSteps = input.maxSteps ?? DEFAULT_GRAPH_MAX_STEPS;

  let state: S = input.initialState;
  let currentNode: NodeId | END = input.spec.entry;
  let step = 0;

  if (input.resume) {
    const last = await store.latest(runId);
    if (last) {
      state = last.state;
      step = last.step;
      currentNode = nextFromEdges(input.spec, last.node, state);
    }
  }

  while (step < maxSteps) {
    if (currentNode === END) break;
    const nodeFn = input.spec.nodes.get(currentNode);
    if (!nodeFn) {
      throw new Error(`unknown node '${String(currentNode)}'`);
    }
    const output = await nodeFn({
      state,
      brain: input.brain,
      runId,
      nodeId: currentNode,
    });

    // Apply patch immutably.
    if ('patch' in output && output.patch) {
      state = Object.freeze({ ...state, ...output.patch });
    }

    step += 1;
    const update: StateUpdate<S> = {
      runId,
      node: currentNode,
      state,
      step,
      at: nowIso(),
      terminal: false,
    };
    await store.save(update);
    yield update;

    // Decide next.
    const goto = (output as { goto?: NodeId | END }).goto;
    if (goto === END) {
      const terminal: StateUpdate<S> = { ...update, terminal: true };
      await store.save(terminal);
      yield terminal;
      return;
    }
    const previousNode = currentNode;
    currentNode = goto ?? nextFromEdges(input.spec, previousNode, state);
  }
}

function nextFromEdges<S>(spec: GraphSpec<S>, from: NodeId, state: S): NodeId | END {
  // Conditional edges take precedence.
  for (const ce of spec.conditionalEdges) {
    if (ce.from === from) return ce.choose(state);
  }
  for (const e of spec.edges) {
    if (e.from === from) return e.to;
  }
  return END;
}

/**
 * Replay a completed run from the checkpoint store. Convenient when
 * resuming after a crash or fast-forwarding through cached steps.
 */
export async function replayFromCheckpoint<S>(
  runId: string,
  store: CheckpointStore<S>,
): Promise<ReadonlyArray<StateUpdate<S>>> {
  return store.list(runId);
}
