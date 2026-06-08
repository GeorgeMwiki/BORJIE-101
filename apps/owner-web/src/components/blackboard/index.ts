/**
 * Borjie blackboard — public surface.
 *
 * Other components import only from this index so the internal module
 * layout stays free to evolve.
 */

export { Blackboard } from './Blackboard';
export { BoardElementRenderer } from './board-element-renderer';
export { parseBoardElements } from './parse-board-elements';
export {
  appendBoardElement,
  clearBoard,
  endReplay,
  focusBoardElement,
  getBoardState,
  removeBoardElement,
  startReplay,
  useBlackboardStore,
} from './use-blackboard-store';
export type { BoardElement, BoardElementEnvelope, BoardElementType } from './types';
export { boardElementSchema } from './types';
// EA-05 — cross-surface CRDT state-bus subscriber (hydrate-on-load + live
// converge). Mounted inside Blackboard; exported for direct use + tests.
export { useSlot, type UseSlotState, type UseSlotOptions } from './use-slot';
