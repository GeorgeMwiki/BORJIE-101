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
