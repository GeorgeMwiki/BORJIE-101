/**
 * Continuity — barrel.
 *
 * The thinking-block continuity layer. The two exports are the only
 * safe path for assembling a follow-up turn:
 *
 *   - prepareNextTurn(...)            : assemble the next request
 *   - assertThinkingBlockOrder(...)   : runtime invariant gate
 *   - extractThinkingBlocks(...)      : read-only accessor for logs
 *   - ThinkingContinuityError         : thrown on violation
 */

export {
  prepareNextTurn,
  assertThinkingBlockOrder,
  extractThinkingBlocks,
  ThinkingContinuityError,
  type PrepareNextTurnArgs,
  type PrepareNextTurnResult,
} from './prepare-next-turn.js';
