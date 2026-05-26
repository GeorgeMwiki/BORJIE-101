/**
 * Backpropagation — walks the path from leaf to root, updating
 * `visits` and `meanValue` per node. See §3.5 of the spec.
 *
 * Operates on an immutable node map and returns a new map. No mutation.
 */

import type { MctsNode } from '../types.js';
import { withBackpropagatedValue } from './tree-node.js';

export type NodeMap = ReadonlyMap<string, MctsNode>;

export function backpropagatePath(input: {
  readonly nodes: NodeMap;
  readonly leafId: string;
  readonly value: number;
}): NodeMap {
  const { leafId, value } = input;
  const next = new Map(input.nodes);
  let currentId: string | null = leafId;

  while (currentId !== null) {
    const node = next.get(currentId);
    if (!node) break;
    const updated = withBackpropagatedValue(node, value);
    next.set(currentId, updated);
    currentId = updated.parentId;
  }

  return next;
}
